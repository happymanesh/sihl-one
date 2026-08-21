import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  canDeactivateTaskStatus,
  canDeleteMasterRow,
  type CreateLeadSourceInput,
  type CreateProductInput,
  type CreateMeetingModeInput,
  type CreateTaskStatusInput,
  type MeetingModeItem,
  type LeadSourceItem,
  type MasterQuery,
  type ProductItem,
  type TaskStatusItem,
  type UpdateLeadSourceInput,
  type UpdateProductInput,
  type UpdateMeetingModeInput,
  type UpdateTaskStatusInput,
} from '@sihl-one/contracts';

import { AuditService, diffRecords } from '../../common/audit.service';
import type { AuthenticatedPrincipal } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Sources and products.
 *
 * Reads are cached in process. Both tables are tiny, change a handful of times
 * a year, and are read on **every lead write** to score it — an uncached lookup
 * would put a query in front of the hottest path in the product to serve ten
 * rows that almost never move. The cache is dropped on any write here, so a
 * change an administrator makes is live on the next request rather than after a
 * timeout somebody has to know about.
 */
@Injectable()
export class MastersService {
  private sourceWeights: Map<string, number> | null = null;
  private activeProductCodes: Set<string> | null = null;
  private activeSourceCodes: Set<string> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------------
  // Used by the rest of the application
  // -------------------------------------------------------------------------

  /** Scoring weight for a source code, for `buildScoringFeatures`. */
  async weightFor(code: string): Promise<number | undefined> {
    if (!this.sourceWeights) {
      const rows = await this.prisma.leadSourceMaster.findMany({
        select: { code: true, scoringWeight: true },
      });
      this.sourceWeights = new Map(rows.map((row) => [row.code, row.scoringWeight]));
    }
    return this.sourceWeights.get(code);
  }

  /**
   * Rejects codes that do not name an active master row.
   *
   * Postgres enforces the source foreign key, but it cannot enforce one on the
   * elements of `productInterest[]`, and neither constraint knows about
   * `isActive`. So this is the check that stops a deactivated product being
   * chosen — and the reason it lives in one place rather than at each call site.
   */
  async assertValid(input: { source?: string; productInterest?: readonly string[] }): Promise<void> {
    if (input.source) {
      if (!this.activeSourceCodes) {
        const rows = await this.prisma.leadSourceMaster.findMany({
          where: { isActive: true },
          select: { code: true },
        });
        this.activeSourceCodes = new Set(rows.map((row) => row.code));
      }
      if (!this.activeSourceCodes.has(input.source)) {
        throw new BadRequestException({
          title: 'Unknown source',
          detail: `"${input.source}" is not an active lead source.`,
        });
      }
    }

    if (input.productInterest?.length) {
      if (!this.activeProductCodes) {
        const rows = await this.prisma.product.findMany({
          where: { isActive: true },
          select: { code: true },
        });
        this.activeProductCodes = new Set(rows.map((row) => row.code));
      }
      const unknown = input.productInterest.filter(
        (code) => !this.activeProductCodes!.has(code),
      );
      if (unknown.length > 0) {
        throw new BadRequestException({
          title: 'Unknown product',
          detail: `Not an active product: ${unknown.join(', ')}.`,
        });
      }
    }
  }

  private invalidate(): void {
    this.sourceWeights = null;
    this.activeProductCodes = null;
    this.activeSourceCodes = null;
  }

  // -------------------------------------------------------------------------
  // Sources
  // -------------------------------------------------------------------------

  async listSources(query: MasterQuery): Promise<LeadSourceItem[]> {
    const rows = await this.prisma.leadSourceMaster.findMany({
      where: {
        ...(query.includeInactive ? {} : { isActive: true }),
        ...(query.q
          ? {
              OR: [
                { code: { contains: query.q, mode: 'insensitive' as const } },
                { label: { contains: query.q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      include: { _count: { select: { leads: { where: { deletedAt: null } } } } },
    });

    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      label: row.label,
      description: row.description,
      scoringWeight: row.scoringWeight,
      isActive: row.isActive,
      isSystem: row.isSystem,
      sortOrder: row.sortOrder,
      leadCount: row._count.leads,
    }));
  }

  async createSource(user: AuthenticatedPrincipal, input: CreateLeadSourceInput) {
    const existing = await this.prisma.leadSourceMaster.findUnique({
      where: { code: input.code },
    });
    if (existing) {
      throw new ConflictException({
        title: 'That code is taken',
        detail: `"${input.code}" is already used by ${existing.label}.`,
      });
    }

    const created = await this.prisma.leadSourceMaster.create({
      data: { ...input, description: input.description ?? null, createdById: user.id },
    });

    this.invalidate();
    await this.audit.record({
      action: 'CREATE',
      resource: 'master.lead_source',
      resourceId: created.id,
      changes: { code: created.code, label: created.label, scoringWeight: created.scoringWeight },
    });

    return created;
  }

  async updateSource(user: AuthenticatedPrincipal, id: string, input: UpdateLeadSourceInput) {
    const before = await this.prisma.leadSourceMaster.findUnique({ where: { id } });
    if (!before) throw new NotFoundException({ title: 'Source not found' });

    const after = await this.prisma.leadSourceMaster.update({ where: { id }, data: input });

    this.invalidate();
    await this.audit.record({
      action: 'UPDATE',
      resource: 'master.lead_source',
      resourceId: id,
      changes: {
        ...(input.label !== undefined ? { label: { from: before.label, to: after.label } } : {}),
        ...(input.scoringWeight !== undefined
          ? { scoringWeight: { from: before.scoringWeight, to: after.scoringWeight } }
          : {}),
        ...(input.isActive !== undefined
          ? { isActive: { from: before.isActive, to: after.isActive } }
          : {}),
      },
    });

    return after;
  }

  async deleteSource(user: AuthenticatedPrincipal, id: string): Promise<void> {
    const row = await this.prisma.leadSourceMaster.findUnique({
      where: { id },
      include: { _count: { select: { leads: true } } },
    });
    if (!row) throw new NotFoundException({ title: 'Source not found' });

    const verdict = canDeleteMasterRow({ isSystem: row.isSystem, leadCount: row._count.leads });
    if (!verdict.ok) {
      throw new BadRequestException({ title: 'Cannot delete', detail: verdict.reason });
    }

    await this.prisma.leadSourceMaster.delete({ where: { id } });
    this.invalidate();
    await this.audit.record({
      action: 'DELETE',
      resource: 'master.lead_source',
      resourceId: id,
      changes: { code: row.code, label: row.label },
    });
  }

  // -------------------------------------------------------------------------
  // Products
  // -------------------------------------------------------------------------

  async listProducts(query: MasterQuery): Promise<ProductItem[]> {
    const rows = await this.prisma.product.findMany({
      where: {
        ...(query.includeInactive ? {} : { isActive: true }),
        ...(query.q
          ? {
              OR: [
                { code: { contains: query.q, mode: 'insensitive' as const } },
                { name: { contains: query.q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        parent: { select: { name: true } },
        children: { select: { code: true } },
      },
    });

    // `productInterest` is an array column, so the count is a separate pass —
    // there is no relation for Prisma to `_count`.
    const counts = await Promise.all(
      rows.map((row) =>
        this.prisma.lead.count({ where: { deletedAt: null, productInterest: { has: row.code } } }),
      ),
    );

    return rows.map((row, index) => ({
      ...row,
      parentName: row.parent?.name ?? null,
      childCodes: row.children.map((child) => child.code),
      leadCount: counts[index]!,
    }));
  }

  async findProduct(code: string): Promise<ProductItem> {
    const row = await this.prisma.product.findUnique({
      where: { code },
      include: { parent: { select: { name: true } }, children: { select: { code: true } } },
    });
    if (!row) throw new NotFoundException({ title: 'Product not found' });

    const leadCount = await this.prisma.lead.count({
      where: { deletedAt: null, productInterest: { has: row.code } },
    });
    return {
      ...row,
      parentName: row.parent?.name ?? null,
      childCodes: row.children.map((child) => child.code),
      leadCount,
    };
  }

  async createProduct(user: AuthenticatedPrincipal, input: CreateProductInput) {
    const existing = await this.prisma.product.findUnique({ where: { code: input.code } });
    if (existing) {
      throw new ConflictException({
        title: 'That code is taken',
        detail: `"${input.code}" is already used by ${existing.name}.`,
      });
    }

    if (input.parentId) {
      const parent = await this.prisma.product.findUnique({
        where: { id: input.parentId },
        select: { id: true, name: true, parentId: true },
      });
      if (!parent) {
        throw new NotFoundException({ title: 'Parent product not found' });
      }
      // Two levels only. Deeper hierarchies read as flexibility and produce a
      // tree nobody can filter sensibly.
      if (parent.parentId) {
        throw new ConflictException({
          title: 'Only two levels are supported',
          detail: `"${parent.name}" is itself a sub-product, so it cannot be a parent.`,
        });
      }
    }

    const created = await this.prisma.product.create({
      data: {
        ...input,
        summary: input.summary ?? null,
        description: input.description ?? null,
        chargesSummary: input.chargesSummary ?? null,
        eligibility: input.eligibility ?? null,
        riskNote: input.riskNote ?? null,
        createdById: user.id,
      },
    });

    this.invalidate();
    await this.audit.record({
      action: 'CREATE',
      resource: 'master.product',
      resourceId: created.id,
      changes: { code: created.code, name: created.name },
    });

    return created;
  }

  async updateProduct(user: AuthenticatedPrincipal, id: string, input: UpdateProductInput) {
    const before = await this.prisma.product.findUnique({ where: { id } });
    if (!before) throw new NotFoundException({ title: 'Product not found' });

    const after = await this.prisma.product.update({ where: { id }, data: input });

    this.invalidate();
    await this.audit.record({
      action: 'UPDATE',
      resource: 'master.product',
      resourceId: id,
      changes: {
        ...(input.name !== undefined ? { name: { from: before.name, to: after.name } } : {}),
        ...(input.isActive !== undefined
          ? { isActive: { from: before.isActive, to: after.isActive } }
          : {}),
        // The catalogue body is what a rep reads to a client, so a change to it
        // is recorded as having happened without copying it into the trail.
        ...(input.description !== undefined ? { description: 'changed' } : {}),
      },
    });

    return after;
  }

  async deleteProduct(user: AuthenticatedPrincipal, id: string): Promise<void> {
    const row = await this.prisma.product.findUnique({ where: { id } });
    if (!row) throw new NotFoundException({ title: 'Product not found' });

    const leadCount = await this.prisma.lead.count({
      where: { deletedAt: null, productInterest: { has: row.code } },
    });

    const verdict = canDeleteMasterRow({ isSystem: row.isSystem, leadCount });
    if (!verdict.ok) {
      throw new BadRequestException({ title: 'Cannot delete', detail: verdict.reason });
    }

    await this.prisma.product.delete({ where: { id } });
    this.invalidate();
    await this.audit.record({
      action: 'DELETE',
      resource: 'master.product',
      resourceId: id,
      changes: { code: row.code, name: row.name },
    });
  }

  // -------------------------------------------------------------------------
  // Task statuses
  // -------------------------------------------------------------------------

  async listTaskStatuses(query: MasterQuery): Promise<TaskStatusItem[]> {
    const rows = await this.prisma.taskStatusMaster.findMany({
      where: {
        entityType: 'TASK',
        ...(query.includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
      include: { _count: { select: { tasks: true } } },
    });

    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      label: row.label,
      meaning: row.meaning,
      category: row.category as TaskStatusItem['category'],
      isActive: row.isActive,
      isSystem: row.isSystem,
      sortOrder: row.sortOrder,
      taskCount: row._count.tasks,
    }));
  }

  async createTaskStatus(user: AuthenticatedPrincipal, input: CreateTaskStatusInput) {
    const existing = await this.prisma.taskStatusMaster.findUnique({ where: { code: input.code } });
    if (existing) {
      throw new ConflictException({
        title: 'That code is taken',
        detail: `"${input.code}" is already used by ${existing.label}.`,
      });
    }

    const created = await this.prisma.taskStatusMaster.create({
      data: { ...input, meaning: input.meaning ?? null, createdById: user.id },
    });

    this.invalidate();
    await this.audit.record({
      action: 'CREATE',
      resource: 'master.taskStatus',
      resourceId: created.id,
      changes: { code: created.code, label: created.label, category: created.category },
    });

    return created;
  }

  async updateTaskStatus(user: AuthenticatedPrincipal, id: string, input: UpdateTaskStatusInput) {
    const before = await this.prisma.taskStatusMaster.findUnique({ where: { id } });
    if (!before) throw new NotFoundException({ title: 'Status not found' });

    // Deactivating the last active status in a category leaves tasks in it with
    // nowhere to go, so the rule is checked here rather than trusted to the UI.
    if (input.isActive === false && before.isActive) {
      const all = await this.listTaskStatuses({ includeInactive: true } as MasterQuery);
      const verdict = canDeactivateTaskStatus(
        { code: before.code, category: before.category as TaskStatusItem['category'], isActive: true },
        all,
      );
      if (!verdict.allowed) {
        throw new ConflictException({ title: 'Cannot switch that off', detail: verdict.reason });
      }
    }

    const after = await this.prisma.taskStatusMaster.update({ where: { id }, data: input });

    this.invalidate();
    await this.audit.record({
      action: 'UPDATE',
      resource: 'master.taskStatus',
      resourceId: id,
      changes: diffRecords(before, after),
    });

    return after;
  }


  // -------------------------------------------------------------------------
  // Meeting modes
  // -------------------------------------------------------------------------

  async listMeetingModes(query: MasterQuery): Promise<MeetingModeItem[]> {
    const rows = await this.prisma.meetingModeMaster.findMany({
      where: query.includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
    return rows as unknown as MeetingModeItem[];
  }

  async createMeetingMode(user: AuthenticatedPrincipal, input: CreateMeetingModeInput) {
    const existing = await this.prisma.meetingModeMaster.findUnique({ where: { code: input.code } });
    if (existing) {
      throw new ConflictException({
        title: 'That code is taken',
        detail: `"${input.code}" is already used by ${existing.label}.`,
      });
    }

    const created = await this.prisma.meetingModeMaster.create({
      data: { ...input, meaning: input.meaning ?? null, createdById: user.id },
    });

    this.invalidate();
    await this.audit.record({
      action: 'CREATE',
      resource: 'master.meetingMode',
      resourceId: created.id,
      changes: { code: created.code, label: created.label },
    });

    return created;
  }

  async updateMeetingMode(user: AuthenticatedPrincipal, id: string, input: UpdateMeetingModeInput) {
    const before = await this.prisma.meetingModeMaster.findUnique({ where: { id } });
    if (!before) throw new NotFoundException({ title: 'Meeting mode not found' });

    // At least one mode must stay usable, or an interaction cannot record how it
    // happened and the field falls back to meaning nothing.
    if (input.isActive === false && before.isActive) {
      const others = await this.prisma.meetingModeMaster.count({
        where: { isActive: true, id: { not: id } },
      });
      if (others === 0) {
        throw new ConflictException({
          title: 'Cannot switch that off',
          detail: 'It is the last active meeting mode — interactions would have no way to record how they happened.',
        });
      }
    }

    const after = await this.prisma.meetingModeMaster.update({ where: { id }, data: input });

    this.invalidate();
    await this.audit.record({
      action: 'UPDATE',
      resource: 'master.meetingMode',
      resourceId: id,
      changes: diffRecords(before, after),
    });

    return after;
  }

}
