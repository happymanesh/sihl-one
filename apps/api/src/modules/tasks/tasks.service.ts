import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  maskMobile,
  type CreateTaskInput,
  type TaskQuery,
  type UpdateTaskInput,
} from '@sihl-one/contracts';

import { AuditService } from '../../common/audit.service';
import { ReferenceService } from '../../common/reference.service';
import { ScopeService } from '../../common/scope.service';
import { paginate, type AuthenticatedPrincipal, type PaginatedResult } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Terminal *categories*, not labels.
 *
 * An administrator may add "Closed — no response" under CANCELLED; it must
 * behave like a cancellation without anyone editing this file. Reading the
 * label here is what would break that.
 */
const TERMINAL_CATEGORIES = new Set(['DONE', 'CANCELLED']);

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly references: ReferenceService,
    private readonly audit: AuditService,
  ) {}

  async list(
    user: AuthenticatedPrincipal,
    query: TaskQuery,
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    const and: Record<string, unknown>[] = [this.scope.taskScope(user)];
    if (query.status) and.push({ status: query.status });
    if (query.assigneeId) and.push({ assigneeId: query.assigneeId });
    if (query.entityType) and.push({ entityType: query.entityType });
    if (query.entityId) and.push({ entityId: query.entityId });
    if (query.dueBefore) and.push({ dueAt: { lte: query.dueBefore } });
    if (query.overdueOnly) {
      and.push({ dueAt: { lt: new Date() }, statusMaster: { category: { in: ['OPEN', 'IN_PROGRESS'] } } });
    }

    const where = { deletedAt: null, AND: and };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.task.findMany({
        where,
        // Due date ascending is the only sensible default for a task list: the
        // thing due first is the thing to do first.
        orderBy: [{ dueAt: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          assignee: { select: { id: true, firstName: true, lastName: true } },
          statusMaster: { select: { label: true, category: true, meaning: true } },
        },
      }),
      this.prisma.task.count({ where }),
    ]);

    // Who each task is about, fetched once for the page rather than per row. A
    // rep triaging a list needs the client's name and number without opening
    // anything — a row reading only "Follow up: collect document" says nothing
    // about who to call.
    const leadIds = rows
      .filter((task) => task.entityType === 'LEAD' && task.entityId)
      .map((task) => task.entityId as string);

    const leadById = new Map<
      string,
      { name: string; mobileMasked: string; reference: string; productInterest: string[] }
    >();
    if (leadIds.length) {
      const leads = await this.prisma.lead.findMany({
        where: { id: { in: [...new Set(leadIds)] } },
        select: {
          id: true,
          reference: true,
          firstName: true,
          lastName: true,
          mobile: true,
          productInterest: true,
        },
      });
      for (const lead of leads) {
        leadById.set(lead.id, {
          name: [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim(),
          // Masked, as on every other list surface. The full number is on the
          // lead itself, one tap away, for whoever's scope allows it.
          mobileMasked: maskMobile(lead.mobile),
          reference: lead.reference,
          productInterest: lead.productInterest,
        });
      }
    }

    const now = new Date();
    return paginate(
      rows.map((task) => ({
        id: task.id,
        reference: task.reference,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        dueAt: task.dueAt.toISOString(),
        isOverdue:
          task.dueAt < now && !TERMINAL_CATEGORIES.has(task.statusMaster?.category ?? 'OPEN'),
        statusLabel: task.statusMaster?.label ?? task.status,
        statusCategory: task.statusMaster?.category ?? 'OPEN',
        entityType: task.entityType,
        entityId: task.entityId,
        productInterest:
          task.entityType === 'LEAD' && task.entityId
            ? (leadById.get(task.entityId)?.productInterest ?? [])
            : [],
        // Null when the task hangs off something else, or off a lead the caller
        // cannot see — the task list is already scoped, but a task can outlive
        // a lead being reassigned out of scope.
        about: task.entityId ? (leadById.get(task.entityId) ?? null) : null,
        assignee: task.assignee
          ? { id: task.assignee.id, fullName: `${task.assignee.firstName} ${task.assignee.lastName}`.trim() }
          : null,
        completedAt: task.completedAt?.toISOString() ?? null,
        createdAt: task.createdAt.toISOString(),
      })),
      total,
      query.page,
      query.pageSize,
    );
  }

  async create(user: AuthenticatedPrincipal, input: CreateTaskInput) {
    const assigneeId = input.assigneeId ?? user.id;
    if (!this.scope.canAssignTo(user, assigneeId)) {
      throw new BadRequestException({
        title: 'Cannot assign that task',
        detail: 'You may only create tasks for yourself or your team.',
      });
    }

    const reference = await this.references.next('TK');
    const task = await this.prisma.task.create({
      data: {
        reference,
        title: input.title,
        description: input.description ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        dueAt: input.dueAt,
        priority: input.priority,
        assigneeId,
        createdById: user.id,
      },
    });

    await this.audit.record({ action: 'CREATE', resource: 'task', resourceId: task.id });
    return { id: task.id, reference: task.reference, title: task.title, status: task.status };
  }

  async update(user: AuthenticatedPrincipal, id: string, input: UpdateTaskInput) {
    const task = await this.prisma.task.findFirst({
      where: { id, deletedAt: null, AND: [this.scope.taskScope(user)] },
      include: { statusMaster: { select: { category: true } } },
    });
    if (!task) throw new NotFoundException({ title: 'Task not found' });

    // Both sides resolved to categories, so a custom status behaves like the
    // class it belongs to rather than like its name.
    const currentCategory = task.statusMaster?.category ?? 'OPEN';
    const nextCategory = input.status
      ? ((
          await this.prisma.taskStatusMaster.findUnique({
            where: { code: input.status },
            select: { category: true, isActive: true },
          })
        )?.category ?? null)
      : null;

    if (input.status && nextCategory === null) {
      throw new BadRequestException({
        title: 'Unknown status',
        detail: 'That status does not exist.',
      });
    }

    if (TERMINAL_CATEGORIES.has(currentCategory) && nextCategory && !TERMINAL_CATEGORIES.has(nextCategory)) {
      throw new BadRequestException({
        title: 'Task is closed',
        detail: 'A completed or cancelled task cannot be reopened. Create a follow-up task instead.',
      });
    }

    if (input.assigneeId && !this.scope.canAssignTo(user, input.assigneeId)) {
      throw new BadRequestException({ title: 'Cannot reassign to that user' });
    }

    const completing = nextCategory === 'DONE' && currentCategory !== 'DONE';

    const updated = await this.prisma.task.update({
      where: { id },
      data: {
        ...input,
        completedAt: completing ? new Date() : undefined,
      },
    });

    await this.audit.record({
      action: 'UPDATE',
      resource: 'task',
      resourceId: id,
      changes: { status: { from: task.status, to: updated.status } },
    });

    return { id: updated.id, status: updated.status, completedAt: updated.completedAt };
  }

  /** Counts for the dashboard task widget. */
  async summary(user: AuthenticatedPrincipal) {
    const base = { deletedAt: null, AND: [this.scope.taskScope(user)] };
    const now = new Date();
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    const [open, overdue, dueToday, completedThisWeek] = await this.prisma.$transaction([
      this.prisma.task.count({ where: { ...base, statusMaster: { category: { in: ['OPEN', 'IN_PROGRESS'] } } } }),
      this.prisma.task.count({
        where: { ...base, statusMaster: { category: { in: ['OPEN', 'IN_PROGRESS'] } }, dueAt: { lt: now } },
      }),
      this.prisma.task.count({
        where: {
          ...base,
          statusMaster: { category: { in: ['OPEN', 'IN_PROGRESS'] } },
          dueAt: { gte: now, lte: endOfToday },
        },
      }),
      this.prisma.task.count({
        where: {
          ...base,
          statusMaster: { category: 'DONE' },
          completedAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
        },
      }),
    ]);

    return { open, overdue, dueToday, completedThisWeek };
  }
}
