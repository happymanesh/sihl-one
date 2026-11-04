import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  maskMobile,
  type CreateTaskInput,
  type TaskQuery,
  type UpdateTaskInput,
} from '@sihl-one/contracts';

import { AuditService } from '../../common/audit.service';
import { OutboxService } from '../../common/outbox.service';
import { ReferenceService } from '../../common/reference.service';
import { istDayEnd, istToday } from '../../common/ist-day';
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
    private readonly outbox: OutboxService,
  ) {}

  async list(
    user: AuthenticatedPrincipal,
    query: TaskQuery,
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    const and: Record<string, unknown>[] = [this.scope.taskScope(user)];
    /*
      Matched on the status master's category, not on the stored code.

      `status` on the query is a `TaskStatus` — OPEN, IN_PROGRESS, DONE,
      CANCELLED — which are the master's *categories*. The column it used to
      be compared against holds a *code*, and the master is
      administrator-editable: a status coded COMPLETED, CLOSED or anything a
      branch chose to call it never equalled 'DONE', so the Completed tab
      returned nothing at all. Cancelled was broken the same way.

      `overdueOnly` below already filtered on the category. The two now agree.
    */
    if (query.status) {
      and.push({ statusMaster: { category: query.status } });
    } else {
      /*
        No status asked for means work in hand, not everything ever.

        The screen offered an "Open" button pointing at bare /tasks and marked
        it active by default, so it looked like the open view. It was not: the
        list returned all 28 tasks while the Open tile beside it said 17, and
        done and cancelled work sat among today's follow-ups. Defaulting here
        rather than in the page keeps the tile and the rows it links to
        counting the same thing.

        An explicit `status` still wins, which is what lets a Completed view
        exist at all.
      */
      and.push({ statusMaster: { category: { in: ['OPEN', 'IN_PROGRESS'] } } });
    }
    if (query.assigneeId) and.push({ assigneeId: query.assigneeId });
    if (query.entityType) and.push({ entityType: query.entityType });
    if (query.entityId) and.push({ entityId: query.entityId });
    if (query.dueBefore) and.push({ dueAt: { lte: query.dueBefore } });
    if (query.overdueOnly) {
      /*
        Overdue means the day passed, not the hour.

        This compared `dueAt` with the current instant, so a task due at nine
        this morning was overdue by ten — on the same day it was meant to be
        done, while the person was still doing it. Reps saw today's work in
        red and the Due today tile skipped it, which is the complaint that
        "any task of today is also considered as Overdue".

        Midnight IST, not `new Date()` and not the process's local midnight.
        The containers run UTC, so a local midnight is half past five in the
        morning here — the same half-day skew CR-13 found in the reports.
      */
      and.push({
        dueAt: { lt: istToday() },
        statusMaster: { category: { in: ['OPEN', 'IN_PROGRESS'] } },
      });
    }

    // --- grid column filters ------------------------------------------------

    if (query.title) and.push({ title: { contains: query.title, mode: 'insensitive' } });
    if (query.reference) {
      and.push({ reference: { contains: query.reference, mode: 'insensitive' } });
    }
    if (query.priority) and.push({ priority: query.priority });
    if (query.dueFrom) and.push({ dueAt: { gte: query.dueFrom } });
    if (query.dueTo) and.push({ dueAt: { lte: query.dueTo } });

    /*
      Filtering by the client the task is about.

      Two steps, because `entityType` + `entityId` is a loose pointer and not
      a relation — there is nothing for the database to join on. The subjects
      are matched first and their ids used to narrow the tasks.

      An empty result is pushed as an impossible id rather than skipped: a
      search that matches nobody must return nothing, not everything.
    */
    if (query.client) {
      const needle = { contains: query.client, mode: 'insensitive' as const };
      const [leads, customers] = await Promise.all([
        this.prisma.lead.findMany({
          where: {
            deletedAt: null,
            OR: [
              { firstName: needle },
              { lastName: needle },
              { mobile: needle },
              { reference: needle },
            ],
          },
          select: { id: true },
        }),
        this.prisma.customer.findMany({
          where: {
            OR: [
              { firstName: needle },
              { lastName: needle },
              { mobile: needle },
              { reference: needle },
            ],
          },
          select: { id: true },
        }),
      ]);

      const subjectIds = [...leads, ...customers].map((row) => row.id);
      and.push({ entityId: { in: subjectIds.length > 0 ? subjectIds : ['__none__'] } });
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

    /*
      Who each task is about, fetched once for the page rather than per row. A
      rep triaging a list needs the client's name and number without opening
      anything — a row reading only "Follow up: collect document" says nothing
      about who to call.

      Customers as well as leads. A visit can be planned against either, and
      completing one with a follow-up date copies the visit's entity onto the
      task — so a customer visit produces a CUSTOMER task. Resolving leads
      alone left those rows blank, which read as a task with no client at all;
      eight of them were deleted from production as orphans before anyone
      realised they were perfectly good customer follow-ups.
    */
    const idsOf = (type: 'LEAD' | 'CUSTOMER') => [
      ...new Set(
        rows
          .filter((task) => task.entityType === type && task.entityId)
          .map((task) => task.entityId as string),
      ),
    ];

    const aboutById = new Map<
      string,
      { name: string; mobileMasked: string; reference: string; productInterest: string[] }
    >();

    const leadIds = idsOf('LEAD');
    if (leadIds.length) {
      const leads = await this.prisma.lead.findMany({
        where: { id: { in: leadIds } },
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
        aboutById.set(lead.id, {
          name: [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim(),
          // Masked, as on every other list surface. The full number is on the
          // lead itself, one tap away, for whoever's scope allows it.
          mobileMasked: maskMobile(lead.mobile),
          reference: lead.reference,
          productInterest: lead.productInterest,
        });
      }
    }

    const customerIds = idsOf('CUSTOMER');
    if (customerIds.length) {
      const customers = await this.prisma.customer.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, reference: true, firstName: true, lastName: true, mobile: true },
      });
      for (const customer of customers) {
        aboutById.set(customer.id, {
          name: [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim(),
          mobileMasked: maskMobile(customer.mobile),
          reference: customer.reference,
          // A customer holds products as accounts rather than as interest, so
          // the chip row stays empty rather than guessing at one.
          productInterest: [],
        });
      }
    }

    // Midnight here, so a row is late on the same terms the filter and the
    // tiles use it.
    const startOfToday = istToday();
    return paginate(
      rows.map((task) => ({
        id: task.id,
        reference: task.reference,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        dueAt: task.dueAt.toISOString(),
        // The same boundary the filter and the tiles use. Three different
        // answers to "is this late" on one screen is how a count ends up
        // disagreeing with the rows beneath it.
        isOverdue:
          task.dueAt < startOfToday &&
          !TERMINAL_CATEGORIES.has(task.statusMaster?.category ?? 'OPEN'),
        statusLabel: task.statusMaster?.label ?? task.status,
        statusCategory: task.statusMaster?.category ?? 'OPEN',
        entityType: task.entityType,
        entityId: task.entityId,
        productInterest:
          task.entityType === 'LEAD' && task.entityId
            ? (aboutById.get(task.entityId)?.productInterest ?? [])
            : [],
        // Null when the task hangs off something else again, or off a record
        // the caller cannot see — the task list is already scoped, but a task
        // can outlive its lead being reassigned out of scope.
        about: task.entityId ? (aboutById.get(task.entityId) ?? null) : null,
        assignee: task.assignee
          ? {
              id: task.assignee.id,
              fullName: `${task.assignee.firstName} ${task.assignee.lastName}`.trim(),
            }
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
    if (!(await this.scope.canAssignTo(user, assigneeId))) {
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

    // A task raised against a lead is part of that lead's story — a commitment
    // somebody made about this client. It belongs on the timeline the rep
    // reads, not only in the admin audit trail. Flagged system-generated so it
    // shows as history and never counts as contact for scoring.
    if (task.entityType && task.entityId) {
      await this.prisma.activity.create({
        data: {
          entityType: task.entityType,
          entityId: task.entityId,
          type: 'SYSTEM',
          direction: 'INTERNAL',
          subject: `Task created: ${task.title}`,
          // Written out for a person to read, in IST — the server clock is UTC
          // and a due date shown five and a half hours early is worse than none.
          body: `Due ${task.dueAt.toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            dateStyle: 'medium',
            timeStyle: 'short',
          })}`,
          actorId: user.id,
          isSystemGenerated: true,
        },
      });
    }

    // Tells the assignee, unless they are the one who created it. The router
    // enforces that; publishing unconditionally here keeps the decision about
    // who needs telling in one place rather than in every service.
    await this.outbox.publish(this.prisma, {
      aggregateType: 'task',
      aggregateId: task.id,
      eventType: 'task.assigned',
      payload: {
        reference: task.reference,
        title: task.title,
        assigneeId,
        actorId: user.id,
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
    const nextStatus = input.status
      ? await this.prisma.taskStatusMaster.findUnique({
          where: { code: input.status },
          select: { category: true, isActive: true },
        })
      : null;
    const nextCategory = nextStatus?.category ?? null;

    if (input.status && !nextStatus) {
      throw new BadRequestException({
        title: 'Unknown status',
        detail: 'That status does not exist.',
      });
    }

    // `isActive` was being selected and then ignored, so a status an
    // administrator had switched off could still be set on a task — and the
    // task would then sit on a status the master screen no longer offers.
    if (nextStatus && !nextStatus.isActive) {
      throw new BadRequestException({
        title: 'That status is switched off',
        detail: 'Pick one of the statuses currently in use.',
      });
    }

    if (
      TERMINAL_CATEGORIES.has(currentCategory) &&
      nextCategory &&
      !TERMINAL_CATEGORIES.has(nextCategory)
    ) {
      throw new BadRequestException({
        title: 'Task is closed',
        detail:
          'A completed or cancelled task cannot be reopened. Create a follow-up task instead.',
      });
    }

    if (input.assigneeId && !(await this.scope.canAssignTo(user, input.assigneeId))) {
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

    // Only completion reaches the timeline. Every other edit — a due date
    // nudged, a priority changed — is bookkeeping, and putting all of it here
    // would bury the calls and meetings the timeline exists to show.
    if (completing && updated.entityType && updated.entityId) {
      await this.prisma.activity.create({
        data: {
          entityType: updated.entityType,
          entityId: updated.entityId,
          type: 'SYSTEM',
          direction: 'INTERNAL',
          subject: `Task completed: ${updated.title}`,
          body: updated.completionNote ?? null,
          actorId: user.id,
          isSystemGenerated: true,
        },
      });
    }

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
    /*
      Both boundaries in IST, which is the only place a "day" means anything
      to this business.

      `new Date(y, m, d, 23, 59, 59)` is the end of the day *the process*
      thinks it is. On Railway that is UTC, so "today" ran from 05:30 to
      05:30 and the tiles were wrong by half a day for everybody.
    */
    const startOfToday = istToday();
    const endOfToday = istDayEnd(now);

    const [open, overdue, dueToday, completedThisWeek] = await this.prisma.$transaction([
      this.prisma.task.count({
        where: { ...base, statusMaster: { category: { in: ['OPEN', 'IN_PROGRESS'] } } },
      }),
      // Overdue: the due day is behind us. Anything due later today belongs
      // in Due today, which is the next count along.
      this.prisma.task.count({
        where: {
          ...base,
          statusMaster: { category: { in: ['OPEN', 'IN_PROGRESS'] } },
          dueAt: { lt: startOfToday },
        },
      }),
      /*
        Due today: the whole day, not the rest of it.

        This started at `now`, so a task due at nine fell out of Due today by
        ten and reappeared under Overdue. The two tiles between them lost
        exactly the tasks a rep had not got to yet this morning — the ones
        most worth showing.
      */
      this.prisma.task.count({
        where: {
          ...base,
          statusMaster: { category: { in: ['OPEN', 'IN_PROGRESS'] } },
          dueAt: { gte: startOfToday, lte: endOfToday },
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
