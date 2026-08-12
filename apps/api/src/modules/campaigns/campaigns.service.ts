import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CAMPAIGN_STATUS_TRANSITIONS,
  campaignTrackingUrl,
  canTransitionCampaign,
  computeCampaignPerformance,
  type CampaignChannel,
  type CampaignDetail,
  type CampaignListItem,
  type CampaignQuery,
  type CampaignStatus,
  type CreateCampaignInput,
  type UpdateCampaignInput,
} from '@sihl-one/contracts';

import { AuditService, diffRecords } from '../../common/audit.service';
import { OutboxService } from '../../common/outbox.service';
import { ReferenceService } from '../../common/reference.service';
import { paginate, type AuthenticatedPrincipal, type PaginatedResult } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { decimalToString } from '../leads/lead.mapper';

const QUALIFIED_ONWARDS = ['QUALIFIED', 'PROPOSAL', 'CONVERTED'] as const;

/**
 * Campaigns.
 *
 * Not scoped by `ScopeService`: a campaign is a company-level object, not a
 * record owned by a branch or a rep, and the permission (`campaign:read`) is the
 * whole of the access decision. The *leads* a campaign attracted are still
 * scoped normally wherever they are listed — this service only ever returns
 * counts and sums over them, never the leads themselves.
 */
@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly references: ReferenceService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async list(query: CampaignQuery): Promise<PaginatedResult<CampaignListItem>> {
    const and: Record<string, unknown>[] = [];

    if (query.q) {
      and.push({
        OR: [
          { name: { contains: query.q, mode: 'insensitive' } },
          { code: { contains: query.q, mode: 'insensitive' } },
          { reference: { contains: query.q, mode: 'insensitive' } },
        ],
      });
    }
    // Archived campaigns are history. They stay queryable by asking for them
    // explicitly, but they do not clutter the list somebody opens to see what
    // is running.
    and.push(query.status ? { status: query.status } : { status: { not: 'ARCHIVED' } });
    if (query.channel) and.push({ channels: { has: query.channel } });

    const where = { deletedAt: null, AND: and };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.campaign.findMany({
        where,
        orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          _count: { select: { leads: { where: { deletedAt: null } } } },
        },
      }),
      this.prisma.campaign.count({ where }),
    ]);

    // Conversions per campaign in one grouped query rather than one per row.
    const conversions = await this.prisma.lead.groupBy({
      by: ['campaignId'],
      where: {
        campaignId: { in: rows.map((row) => row.id) },
        deletedAt: null,
        status: 'CONVERTED',
      },
      _count: { _all: true },
      orderBy: { campaignId: 'asc' },
    });
    const convertedByCampaign = new Map(
      conversions.map((row) => [row.campaignId, row._count._all]),
    );

    const owners = await this.ownerMap(rows.map((row) => row.ownerId));

    return paginate(
      rows.map((row) => {
        const leads = row._count.leads;
        const converted = convertedByCampaign.get(row.id) ?? 0;
        return {
          ...this.toListItem(row, owners),
          leads,
          converted,
          conversionRate: leads > 0 ? Math.round((converted / leads) * 1000) / 10 : 0,
        };
      }),
      total,
      query.page,
      query.pageSize,
    );
  }

  async findOne(id: string): Promise<CampaignDetail> {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, deletedAt: null },
    });
    if (!campaign) throw new NotFoundException({ title: 'Campaign not found' });

    const leadWhere = { campaignId: id, deletedAt: null };

    // Grouped outside `$transaction([...])`: grouping inside it widens the
    // tuple type enough that `_count` stops being inferable as a number — the
    // same trap the dashboard hit. Nothing here has to reconcile to the row,
    // and `total` is summed from `byStatus` so the two cannot disagree.
    const [byStatus, bySource, convertedBySource, convertedValue] = await Promise.all([
      this.prisma.lead.groupBy({
        by: ['status'],
        where: leadWhere,
        _count: { _all: true },
        _sum: { estimatedValue: true },
        orderBy: { status: 'asc' },
      }),
      this.prisma.lead.groupBy({
        by: ['utmSource'],
        where: leadWhere,
        _count: { _all: true },
        orderBy: { utmSource: 'asc' },
      }),
      // Converted counts per source need their own pass — grouping by two
      // columns returns a row per (source, status) pair and forces the same
      // reshaping here anyway, with more rows over the wire.
      this.prisma.lead.groupBy({
        by: ['utmSource'],
        where: { ...leadWhere, status: 'CONVERTED' },
        _count: { _all: true },
        orderBy: { utmSource: 'asc' },
      }),
      this.prisma.lead.aggregate({
        where: { ...leadWhere, status: 'CONVERTED' },
        _sum: { estimatedValue: true },
      }),
    ]);

    const countFor = (statuses: readonly string[]): number =>
      byStatus
        .filter((row) => statuses.includes(row.status))
        .reduce((sum, row) => sum + row._count._all, 0);

    const total = byStatus.reduce((sum, row) => sum + row._count._all, 0);
    const converted = countFor(['CONVERTED']);
    const qualified = countFor(QUALIFIED_ONWARDS);

    const convertedSourceMap = new Map(
      convertedBySource.map((row) => [row.utmSource ?? 'direct', row._count._all]),
    );

    const owners = await this.ownerMap([campaign.ownerId]);

    const performance = computeCampaignPerformance({
      leads: total,
      qualified,
      converted,
      convertedValue: Number(convertedValue._sum.estimatedValue ?? 0),
      spend: campaign.actualSpend === null ? null : Number(campaign.actualSpend),
      budget: campaign.budget === null ? null : Number(campaign.budget),
    });

    return {
      ...this.toListItem(campaign, owners),
      leads: total,
      converted,
      conversionRate: performance.conversionRate,
      performance,
      sources: bySource
        .map((row) => ({
          source: row.utmSource ?? 'direct',
          leads: row._count._all,
          converted: convertedSourceMap.get(row.utmSource ?? 'direct') ?? 0,
        }))
        .sort((a, b) => b.leads - a.leads),
      pipeline: byStatus
        .map((row) => ({
          status: row.status,
          count: row._count._all,
          value: decimalToString(row._sum.estimatedValue) ?? '0',
        }))
        .sort((a, b) => b.count - a.count),
      allowedTransitions: [...CAMPAIGN_STATUS_TRANSITIONS[campaign.status as CampaignStatus]],
      trackingUrl: campaignTrackingUrl(
        `${process.env.PUBLIC_WEB_URL ?? 'http://localhost:3000'}/`,
        campaign.code,
        campaign.channels[0] as CampaignChannel | undefined,
      ),
    };
  }

  async create(user: AuthenticatedPrincipal, input: CreateCampaignInput) {
    const existing = await this.prisma.campaign.findUnique({ where: { code: input.code } });
    if (existing) {
      // Named explicitly rather than returned as a generic constraint error:
      // the code is the one field the user cannot change later, so they need to
      // know now, not after the campaign exists.
      throw new ConflictException({
        title: 'That campaign code is taken',
        detail: `"${input.code}" is already used by ${existing.name}. Codes must be unique because they appear in tracking links.`,
      });
    }

    const reference = await this.references.next('CM');

    const campaign = await this.prisma.$transaction(async (tx) => {
      const created = await tx.campaign.create({
        data: {
          reference,
          name: input.name,
          code: input.code,
          objective: input.objective ?? null,
          channels: input.channels,
          budget: input.budget ?? null,
          startsAt: input.startsAt ?? null,
          endsAt: input.endsAt ?? null,
          ownerId: input.ownerId ?? user.id,
          createdById: user.id,
        },
      });

      await this.outbox.publish(tx, {
        aggregateType: 'campaign',
        aggregateId: created.id,
        eventType: 'campaign.created',
        payload: { reference, code: created.code, name: created.name },
      });

      return created;
    });

    await this.audit.record({
      action: 'CREATE',
      resource: 'campaign',
      resourceId: campaign.id,
      changes: { name: campaign.name, code: campaign.code, channels: campaign.channels },
    });

    return this.findOne(campaign.id);
  }

  async update(user: AuthenticatedPrincipal, id: string, input: UpdateCampaignInput) {
    const before = await this.prisma.campaign.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException({ title: 'Campaign not found' });

    if (before.status === 'ARCHIVED') {
      throw new BadRequestException({
        title: 'Campaign is archived',
        detail: 'An archived campaign is a historical record and cannot be edited.',
      });
    }

    const startsAt = input.startsAt === undefined ? before.startsAt : input.startsAt;
    const endsAt = input.endsAt === undefined ? before.endsAt : input.endsAt;
    if (startsAt && endsAt && endsAt < startsAt) {
      // Re-checked here because each date can be sent on its own: the schema
      // only sees the half of the pair that arrived.
      throw new BadRequestException({
        title: 'Invalid dates',
        detail: 'The end date cannot be before the start date.',
      });
    }

    const after = await this.prisma.campaign.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.objective !== undefined ? { objective: input.objective } : {}),
        ...(input.channels !== undefined ? { channels: input.channels } : {}),
        ...(input.budget !== undefined ? { budget: input.budget } : {}),
        ...(input.actualSpend !== undefined ? { actualSpend: input.actualSpend } : {}),
        ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
        ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
        ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
      },
    });

    await this.audit.record({
      action: 'UPDATE',
      resource: 'campaign',
      resourceId: id,
      changes: diffRecords(before as never, after as never),
    });

    return this.findOne(id);
  }

  async changeStatus(user: AuthenticatedPrincipal, id: string, status: CampaignStatus) {
    const campaign = await this.prisma.campaign.findFirst({ where: { id, deletedAt: null } });
    if (!campaign) throw new NotFoundException({ title: 'Campaign not found' });

    const from = campaign.status as CampaignStatus;
    if (from === status) return this.findOne(id);

    if (!canTransitionCampaign(from, status)) {
      throw new BadRequestException({
        title: 'Status change not allowed',
        detail:
          CAMPAIGN_STATUS_TRANSITIONS[from].length === 0
            ? `A ${from.toLowerCase()} campaign is final and cannot change status.`
            : `A ${from.toLowerCase()} campaign can only move to: ${CAMPAIGN_STATUS_TRANSITIONS[from].join(', ')}.`,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.campaign.update({
        where: { id },
        data: {
          status,
          // Starting a campaign that was never given a start date should record
          // one, otherwise the report has nothing to measure duration against.
          ...(status === 'RUNNING' && !campaign.startsAt ? { startsAt: new Date() } : {}),
          ...(status === 'COMPLETED' && !campaign.endsAt ? { endsAt: new Date() } : {}),
        },
      });

      await this.outbox.publish(tx, {
        aggregateType: 'campaign',
        aggregateId: id,
        eventType: `campaign.${status.toLowerCase()}`,
        payload: { reference: campaign.reference, code: campaign.code, from, to: status },
      });
    });

    await this.audit.record({
      action: 'STATUS_CHANGE',
      resource: 'campaign',
      resourceId: id,
      changes: { status: { from, to: status } },
    });

    return this.findOne(id);
  }

  // -------------------------------------------------------------------------

  private async ownerMap(ids: Array<string | null>) {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (unique.length === 0) return new Map<string, { id: string; fullName: string }>();

    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, firstName: true, lastName: true },
    });

    return new Map(
      users.map((user) => [
        user.id,
        { id: user.id, fullName: `${user.firstName} ${user.lastName}`.trim() },
      ]),
    );
  }

  private toListItem(
    row: {
      id: string;
      reference: string;
      name: string;
      code: string;
      status: string;
      channels: string[];
      objective: string | null;
      budget: unknown;
      actualSpend: unknown;
      startsAt: Date | null;
      endsAt: Date | null;
      ownerId: string | null;
      createdAt: Date;
    },
    owners: Map<string, { id: string; fullName: string }>,
  ): CampaignListItem {
    return {
      id: row.id,
      reference: row.reference,
      name: row.name,
      code: row.code,
      status: row.status as CampaignStatus,
      channels: row.channels as CampaignChannel[],
      objective: row.objective,
      budget: decimalToString(row.budget as never),
      actualSpend: decimalToString(row.actualSpend as never),
      startsAt: row.startsAt?.toISOString() ?? null,
      endsAt: row.endsAt?.toISOString() ?? null,
      owner: row.ownerId ? (owners.get(row.ownerId) ?? null) : null,
      leads: 0,
      converted: 0,
      conversionRate: 0,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
