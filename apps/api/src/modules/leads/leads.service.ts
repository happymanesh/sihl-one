import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  canTransitionLead,
  LEAD_STATUS_TRANSITIONS,
  maskPan,
  nextBestActions,
  scoreBandFor,
  STRONG_LEAD_SCORE,
  type AssignLeadInput,
  type BulkAssignLeadInput,
  type ChangeLeadStatusInput,
  type ConvertLeadInput,
  type CreateLeadInput,
  type LeadCaptureInput,
  type LeadListItem,
  type LeadQuery,
  type LeadStatus,
  type UpdateLeadInput,
} from '@sihl-one/contracts';

import { AuditService, diffRecords } from '../../common/audit.service';
import { OutboxService } from '../../common/outbox.service';
import { ReferenceService } from '../../common/reference.service';
import { ScopeService } from '../../common/scope.service';
import { RequestContextStore } from '../../common/request-context';
import { paginate, type AuthenticatedPrincipal, type PaginatedResult } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { CaptureCodeService } from '../events/capture-code.service';
import { MastersService } from '../masters/masters.service';
import { AllocationService } from '../performance/allocation.service';
import {
  buildScoringFeatures,
  decimalToString,
  rescore,
  toLeadListItem,
  type LeadRow,
} from './lead.mapper';

const LIST_SELECT = {
  id: true,
  reference: true,
  firstName: true,
  lastName: true,
  mobile: true,
  email: true,
  pan: true,
  city: true,
  status: true,
  source: true,
  priority: true,
  productInterest: true,
  score: true,
  estimatedValue: true,
  nextFollowUpAt: true,
  lastActivityAt: true,
  createdAt: true,
  campaignId: true,
  owner: { select: { id: true, firstName: true, lastName: true } },
  partner: { select: { id: true, name: true } },
} as const;

const SORTABLE_COLUMNS = new Set([
  'createdAt',
  'updatedAt',
  'score',
  'nextFollowUpAt',
  'lastActivityAt',
  'priority',
  'status',
  'firstName',
]);

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly references: ReferenceService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly allocation: AllocationService,
    private readonly captureCodes: CaptureCodeService,
    private readonly masters: MastersService,
  ) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /**
   * Widen a product filter to include sub-products.
   *
   * Someone asking for "Equity" expects its sub-products in the answer, not an
   * empty list because those leads carry the child code instead. Done here
   * rather than in `buildWhere`, which is synchronous and shared.
   */
  private async withSubProducts(query: LeadQuery): Promise<LeadQuery> {
    if (!query.productInterest?.length) return query;

    const children = await this.prisma.product.findMany({
      where: { parent: { code: { in: query.productInterest } } },
      select: { code: true },
    });
    if (children.length === 0) return query;

    return {
      ...query,
      productInterest: [
        ...new Set([...query.productInterest, ...children.map((child) => child.code)]),
      ],
    };
  }

  async list(user: AuthenticatedPrincipal, query: LeadQuery): Promise<PaginatedResult<LeadListItem>> {
    const where = this.buildWhere(user, await this.withSubProducts(query));

    // `sortBy` reaches Prisma as an object key, so it is checked against an
    // allow-list rather than passed through. An arbitrary string here would let
    // a caller order by a column they cannot read and infer its values.
    const sortBy = query.sortBy && SORTABLE_COLUMNS.has(query.sortBy) ? query.sortBy : 'createdAt';

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where,
        select: LIST_SELECT,
        orderBy: { [sortBy]: query.sortDir },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.lead.count({ where }),
    ]);

    return paginate(
      rows.map((row) => toLeadListItem(row as unknown as LeadRow)),
      total,
      query.page,
      query.pageSize,
    );
  }

  /**
   * Kanban column counts.
   *
   * Computed with a grouped count rather than by loading the board, because a
   * manager's pipeline can be tens of thousands of rows and the board only ever
   * shows the first page of each column.
   */
  async pipeline(user: AuthenticatedPrincipal, query: LeadQuery) {
    const expanded = await this.withSubProducts(query);
    const where = this.buildWhere(user, { ...expanded, status: undefined });

    const [counts, values] = await Promise.all([
      this.prisma.lead.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.lead.groupBy({ by: ['status'], where, _sum: { estimatedValue: true } }),
    ]);

    const valueByStatus = new Map(values.map((row) => [row.status, row._sum.estimatedValue]));

    return {
      columns: (Object.keys(LEAD_STATUS_TRANSITIONS) as LeadStatus[]).map((status) => ({
        status,
        count: counts.find((row) => row.status === status)?._count._all ?? 0,
        estimatedValue: decimalToString(valueByStatus.get(status)) ?? '0',
      })),
      total: counts.reduce((sum, row) => sum + row._count._all, 0),
    };
  }

  /**
   * Full lead detail. Returns unmasked contact details, so the read itself is
   * audited — "who looked at this customer's phone number" is a question a
   * regulator can ask, and it is unanswerable without a READ audit row.
   */
  async findOne(user: AuthenticatedPrincipal, id: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, deletedAt: null, AND: [this.scope.leadScope(user)] },
      include: {
        owner: { select: { id: true, firstName: true, lastName: true, email: true } },
        partner: { select: { id: true, name: true, type: true } },
        campaign: { select: { id: true, name: true, code: true } },
        orgUnit: { select: { id: true, name: true } },
        statusHistory: { orderBy: { changedAt: 'desc' }, take: 50 },
        customer: { select: { id: true, reference: true, clientCode: true } },
      },
    });

    if (!lead) {
      // Deliberately the same 404 whether the lead does not exist or is simply
      // out of scope: distinguishing them confirms the existence of records the
      // caller is not allowed to know about.
      throw new NotFoundException({
        title: 'Lead not found',
        detail: 'No lead with that id is visible to you.',
      });
    }

    const [activityCount, activities] = await Promise.all([
      this.prisma.activity.count({ where: { entityType: 'LEAD', entityId: id } }),
      this.prisma.activity.findMany({
        where: { entityType: 'LEAD', entityId: id },
        orderBy: { occurredAt: 'desc' },
        take: 25,
        include: { actor: { select: { id: true, firstName: true, lastName: true } } },
      }),
    ]);

    await this.audit.record({ action: 'READ', resource: 'lead', resourceId: id });

    const features = buildScoringFeatures(lead, activityCount);
    const actions = nextBestActions(features, {
      status: lead.status,
      hasOwner: Boolean(lead.ownerId),
      followUpOverdue: Boolean(lead.nextFollowUpAt && lead.nextFollowUpAt < new Date()),
    });

    return {
      id: lead.id,
      reference: lead.reference,
      firstName: lead.firstName,
      lastName: lead.lastName,
      fullName: `${lead.firstName} ${lead.lastName ?? ''}`.trim(),
      mobile: lead.mobile,
      email: lead.email,
      panMasked: maskPan(lead.pan),
      city: lead.city,
      state: lead.state,
      pincode: lead.pincode,
      status: lead.status,
      source: lead.source,
      priority: lead.priority,
      productInterest: lead.productInterest,
      estimatedValue: decimalToString(lead.estimatedValue),
      score: lead.score,
      scoreBand: scoreBandFor(lead.score),
      scoreFactors: lead.scoreFactors ?? [],
      nextBestActions: actions,
      owner: lead.owner
        ? {
            id: lead.owner.id,
            fullName: `${lead.owner.firstName} ${lead.owner.lastName}`.trim(),
            email: lead.owner.email,
          }
        : null,
      partner: lead.partner,
      campaign: lead.campaign,
      orgUnit: lead.orgUnit,
      customer: lead.customer,
      attribution: {
        utmSource: lead.utmSource,
        utmMedium: lead.utmMedium,
        utmCampaign: lead.utmCampaign,
        referrerUrl: lead.referrerUrl,
        landingPath: lead.landingPath,
      },
      nextFollowUpAt: lead.nextFollowUpAt?.toISOString() ?? null,
      lastActivityAt: lead.lastActivityAt?.toISOString() ?? null,
      convertedAt: lead.convertedAt?.toISOString() ?? null,
      lostReason: lead.lostReason,
      lostNote: lead.lostNote,
      createdAt: lead.createdAt.toISOString(),
      updatedAt: lead.updatedAt.toISOString(),
      allowedTransitions: LEAD_STATUS_TRANSITIONS[lead.status as LeadStatus],
      activityCount,
      statusHistory: lead.statusHistory.map((entry) => ({
        id: entry.id,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        note: entry.note,
        changedAt: entry.changedAt.toISOString(),
        durationSeconds: entry.durationSeconds,
      })),
      timeline: activities.map((activity) => ({
        id: activity.id,
        type: activity.type,
        direction: activity.direction,
        subject: activity.subject,
        body: activity.body,
        outcome: activity.outcome,
        occurredAt: activity.occurredAt.toISOString(),
        isSystemGenerated: activity.isSystemGenerated,
        actor: activity.actor
          ? { id: activity.actor.id, fullName: `${activity.actor.firstName} ${activity.actor.lastName}`.trim() }
          : null,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  async create(user: AuthenticatedPrincipal, input: CreateLeadInput) {
    await this.assertNoOpenDuplicate(input.mobile);

    // A lead created by a salesperson defaults to that salesperson. Leaving it
    // unassigned would put it in a queue nobody is watching.
    const ownerId = input.ownerId ?? (user.userType === 'INTERNAL' ? user.id : null);
    if (input.ownerId && !this.scope.canAssignTo(user, input.ownerId)) {
      throw new ForbiddenException({
        title: 'Cannot assign to that user',
        detail: 'You may only assign leads to yourself or to your team.',
      });
    }

    // The codes must name active master rows. Postgres enforces the source
    // foreign key but knows nothing about `isActive`, and cannot constrain the
    // elements of an array column at all.
    await this.masters.assertValid({
      source: input.source,
      productInterest: input.productInterest,
    });

    const sourceWeight = await this.masters.weightFor(input.source);
    const reference = await this.references.next('LD');
    const orgUnitId = input.ownerId ? await this.orgUnitOf(input.ownerId) : user.orgUnitId;
    const campaignId = await this.resolveCampaignId(
      input.campaignId,
      input.attribution?.utmCampaign,
    );

    const lead = await this.prisma.$transaction(async (tx) => {
      const created = await tx.lead.create({
        data: {
          reference,
          firstName: input.firstName,
          lastName: input.lastName ?? null,
          mobile: input.mobile,
          email: input.email ?? null,
          pan: input.pan ?? null,
          city: input.city ?? null,
          state: input.state ?? null,
          pincode: input.pincode ?? null,
          source: input.source,
          productInterest: input.productInterest,
          priority: input.priority,
          estimatedValue: input.estimatedValue ?? null,
          ownerId,
          orgUnitId,
          partnerId: input.partnerId ?? user.partnerId ?? null,
          campaignId,
          utmSource: input.attribution?.utmSource ?? null,
          utmMedium: input.attribution?.utmMedium ?? null,
          utmCampaign: input.attribution?.utmCampaign ?? null,
          utmTerm: input.attribution?.utmTerm ?? null,
          utmContent: input.attribution?.utmContent ?? null,
          referrerUrl: input.attribution?.referrerUrl ?? null,
          landingPath: input.attribution?.landingPath ?? null,
          gclid: input.attribution?.gclid ?? null,
          fbclid: input.attribution?.fbclid ?? null,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const scored = rescore(created, 0, sourceWeight);
      const lead = await tx.lead.update({ where: { id: created.id }, data: scored as never });

      await tx.leadStatusHistory.create({
        data: { leadId: created.id, fromStatus: null, toStatus: 'NEW', changedById: user.id },
      });

      if (input.notes) {
        await tx.activity.create({
          data: {
            entityType: 'LEAD',
            entityId: created.id,
            type: 'NOTE',
            direction: 'INTERNAL',
            subject: 'Lead created',
            body: input.notes,
            actorId: user.id,
          },
        });
      }

      await this.outbox.publish(tx, {
        aggregateType: 'lead',
        aggregateId: created.id,
        eventType: 'lead.created',
        payload: { reference, source: input.source, ownerId, score: scored.score },
      });

      return lead;
    });

    await this.audit.record({
      action: 'CREATE',
      resource: 'lead',
      resourceId: lead.id,
      changes: { reference, source: input.source, ownerId },
    });

    return this.findOne(user, lead.id);
  }

  /**
   * Public lead capture from a marketing page.
   *
   * Differs from `create` in three ways that matter: there is no authenticated
   * user, a repeat enquiry attaches to the existing open lead instead of
   * failing with a duplicate error, and consent is recorded verbatim.
   */
  async capture(input: LeadCaptureInput) {
    const context = RequestContextStore.get();

    const existing = await this.prisma.lead.findFirst({
      where: {
        mobile: input.mobile,
        deletedAt: null,
        status: { notIn: ['CONVERTED', 'LOST', 'DISQUALIFIED'] },
      },
      select: { id: true, reference: true },
    });

    if (existing) {
      // Re-enquiry. Logging it on the existing lead is what stops a second RM
      // being assigned to the same person, and it is genuine signal: someone
      // filling the form twice is more interested, not less.
      await this.prisma.$transaction(async (tx) => {
        await tx.activity.create({
          data: {
            entityType: 'LEAD',
            entityId: existing.id,
            type: 'NOTE',
            direction: 'INBOUND',
            subject: 'Repeat enquiry from website',
            body: input.message ?? 'The visitor submitted the enquiry form again.',
            metadata: { source: input.source, attribution: input.attribution ?? null } as never,
          },
        });
        await tx.lead.update({
          where: { id: existing.id },
          data: { lastActivityAt: new Date(), priority: 'HIGH' },
        });
        await tx.consentRecord.create({
          data: {
            entityType: 'LEAD',
            entityId: existing.id,
            leadId: existing.id,
            purpose: 'MARKETING_CONTACT',
            granted: true,
            channel: 'WEB_FORM',
            consentText: 'I agree to be contacted by SIHL about this enquiry.',
            ipAddress: context?.ipAddress ?? null,
            userAgent: context?.userAgent?.slice(0, 400) ?? null,
          },
        });
      });

      return { reference: existing.reference, duplicate: true };
    }

    await this.masters.assertValid({
      source: input.source,
      productInterest: input.productInterest,
    });

    const sourceWeight = await this.masters.weightFor(input.source);
    const reference = await this.references.next('LD');

    // Codes in, ids out. Resolved here rather than trusted from the browser:
    // this endpoint is unauthenticated, so an id in the payload would let
    // anyone attribute someone else's business to themselves.
    const coded = await this.captureCodes.resolve({
      partnerCode: input.partnerCode,
      eventCode: input.eventCode,
    });

    const campaignId =
      coded.campaignId ?? (await this.resolveCampaignId(null, input.attribution?.utmCampaign));

    const lead = await this.prisma.$transaction(async (tx) => {
      const created = await tx.lead.create({
        data: {
          reference,
          firstName: input.firstName,
          lastName: input.lastName || null,
          mobile: input.mobile,
          email: input.email || null,
          city: input.city ?? null,
          source: coded.source ?? input.source,
          productInterest: input.productInterest,
          campaignId,
          partnerId: coded.partnerId,
          eventId: coded.eventId,
          // An event names the person running the stall, so the lead reaches
          // them rather than sitting in an unowned queue over a weekend.
          ownerId: coded.suggestedOwnerId,
          utmSource: input.attribution?.utmSource ?? null,
          utmMedium: input.attribution?.utmMedium ?? null,
          utmCampaign: input.attribution?.utmCampaign ?? null,
          utmTerm: input.attribution?.utmTerm ?? null,
          utmContent: input.attribution?.utmContent ?? null,
          referrerUrl: input.attribution?.referrerUrl ?? null,
          landingPath: input.attribution?.landingPath ?? null,
          gclid: input.attribution?.gclid ?? null,
          fbclid: input.attribution?.fbclid ?? null,
        },
      });

      const scored = rescore(created, 0, sourceWeight);
      await tx.lead.update({ where: { id: created.id }, data: scored as never });

      await tx.leadStatusHistory.create({
        data: { leadId: created.id, toStatus: 'NEW' },
      });

      if (input.message) {
        await tx.activity.create({
          data: {
            entityType: 'LEAD',
            entityId: created.id,
            type: 'NOTE',
            direction: 'INBOUND',
            subject: 'Website enquiry',
            body: input.message,
          },
        });
      }

      // DPDP Act 2023: consent must be recorded with the exact text shown, the
      // timestamp, and enough context to prove it was freely given.
      await tx.consentRecord.create({
        data: {
          entityType: 'LEAD',
          entityId: created.id,
          leadId: created.id,
          purpose: 'MARKETING_CONTACT',
          granted: true,
          channel: 'WEB_FORM',
          consentText: 'I agree to be contacted by SIHL about this enquiry.',
          ipAddress: context?.ipAddress ?? null,
          userAgent: context?.userAgent?.slice(0, 400) ?? null,
        },
      });

      await this.outbox.publish(tx, {
        aggregateType: 'lead',
        aggregateId: created.id,
        eventType: 'lead.captured',
        payload: { reference, source: input.source, utmCampaign: input.attribution?.utmCampaign ?? null },
      });

      return created;
    });

    await this.audit.record({
      action: 'CREATE',
      resource: 'lead.capture',
      resourceId: lead.id,
      changes: { reference, source: input.source },
    });

    return { reference, duplicate: false };
  }

  async update(user: AuthenticatedPrincipal, id: string, input: UpdateLeadInput) {
    const before = await this.mustFindInScope(user, id);

    if (before.status === 'CONVERTED') {
      throw new BadRequestException({
        title: 'Converted leads are read-only',
        detail: 'Edit the customer record instead.',
      });
    }

    const { status, attribution, notes, ...rest } = input;
    if (status && status !== before.status) {
      throw new BadRequestException({
        title: 'Use the status endpoint',
        detail: 'Status changes go through POST /leads/:id/status so the transition is validated.',
      });
    }

    const updated = await this.prisma.lead.update({
      where: { id },
      data: {
        ...rest,
        estimatedValue: rest.estimatedValue ?? undefined,
        updatedById: user.id,
      },
    });

    const activityCount = await this.prisma.activity.count({
      where: { entityType: 'LEAD', entityId: id },
    });
    const scored = rescore(updated, activityCount);
    const final = await this.prisma.lead.update({ where: { id }, data: scored as never });

    await this.audit.record({
      action: 'UPDATE',
      resource: 'lead',
      resourceId: id,
      changes: diffRecords(
        before as unknown as Record<string, unknown>,
        final as unknown as Record<string, unknown>,
      ) as Record<string, unknown> | null,
    });

    return this.findOne(user, id);
  }

  /**
   * Status change. The transition table is the authority, not the caller.
   *
   * Also records how long the lead sat in the previous status, which is what
   * makes stage-duration and drop-off analysis a simple query later instead of
   * a window function over the whole history table.
   */
  async changeStatus(user: AuthenticatedPrincipal, id: string, input: ChangeLeadStatusInput) {
    const lead = await this.mustFindInScope(user, id);

    if (lead.status === input.status) {
      throw new BadRequestException({
        title: 'No change',
        detail: `The lead is already ${input.status}.`,
      });
    }

    if (!canTransitionLead(lead.status as LeadStatus, input.status)) {
      throw new BadRequestException({
        title: 'Invalid status change',
        detail:
          `A lead cannot move from ${lead.status} to ${input.status}. ` +
          `Allowed: ${LEAD_STATUS_TRANSITIONS[lead.status as LeadStatus].join(', ') || 'none'}.`,
      });
    }

    if (input.status === 'CONVERTED') {
      throw new BadRequestException({
        title: 'Use the convert endpoint',
        detail: 'Conversion creates a customer record and requires a PAN and email.',
      });
    }

    const lastChange = await this.prisma.leadStatusHistory.findFirst({
      where: { leadId: id },
      orderBy: { changedAt: 'desc' },
      select: { changedAt: true },
    });
    const durationSeconds = lastChange
      ? Math.floor((Date.now() - lastChange.changedAt.getTime()) / 1000)
      : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id },
        data: {
          status: input.status,
          lostReason: input.status === 'LOST' ? (input.lostReason ?? null) : null,
          lostNote: input.status === 'LOST' ? (input.note ?? null) : null,
          contactedAt: input.status === 'CONTACTED' ? new Date() : lead.contactedAt,
          qualifiedAt: input.status === 'QUALIFIED' ? new Date() : lead.qualifiedAt,
          closedAt: ['LOST', 'DISQUALIFIED'].includes(input.status) ? new Date() : null,
          nextFollowUpAt: input.nextFollowUpAt ?? lead.nextFollowUpAt,
          lastActivityAt: new Date(),
          updatedById: user.id,
        },
      });

      await tx.leadStatusHistory.create({
        data: {
          leadId: id,
          fromStatus: lead.status,
          toStatus: input.status,
          note: input.note ?? null,
          changedById: user.id,
          durationSeconds,
        },
      });

      // A status change is part of the interaction story, so it belongs on the
      // same timeline the RM reads — flagged as system-generated so it does not
      // inflate the engagement count the score depends on.
      await tx.activity.create({
        data: {
          entityType: 'LEAD',
          entityId: id,
          type: 'STATUS_CHANGE',
          direction: 'INTERNAL',
          subject: `Status changed from ${lead.status} to ${input.status}`,
          body: input.note ?? null,
          actorId: user.id,
          isSystemGenerated: true,
        },
      });

      await this.outbox.publish(tx, {
        aggregateType: 'lead',
        aggregateId: id,
        eventType: `lead.status.${input.status.toLowerCase()}`,
        payload: { reference: lead.reference, from: lead.status, to: input.status },
      });
    });

    await this.audit.record({
      action: 'STATUS_CHANGE',
      resource: 'lead',
      resourceId: id,
      changes: { from: lead.status, to: input.status },
      reason: input.note ?? null,
    });

    return this.findOne(user, id);
  }


  /**
   * Resolves `utm_campaign` to a real campaign.
   *
   * Without this the campaign code is stored as a string and nothing links to
   * it, so every campaign report reads zero while the leads sit in the database
   * with the right code on them. Case-insensitive because the code travels
   * through published links, email clients and, eventually, someone retyping it.
   *
   * A code that matches nothing is left alone rather than rejected: the lead is
   * real and arrived, and losing it because marketing mistyped a link would be
   * a far worse failure than an unattributed lead.
   */
  private async resolveCampaignId(
    explicitId: string | null | undefined,
    utmCampaign: string | null | undefined,
  ): Promise<string | null> {
    if (explicitId) return explicitId;
    if (!utmCampaign) return null;

    const campaign = await this.prisma.campaign.findFirst({
      where: { code: { equals: utmCampaign.trim(), mode: 'insensitive' }, deletedAt: null },
      select: { id: true },
    });

    return campaign?.id ?? null;
  }

  async assign(user: AuthenticatedPrincipal, id: string, input: AssignLeadInput) {
    const lead = await this.mustFindInScope(user, id);

    if (!this.scope.canAssignTo(user, input.ownerId)) {
      throw new ForbiddenException({
        title: 'Cannot assign to that user',
        detail: 'You may only assign leads to yourself or to members of your team.',
      });
    }

    const owner = await this.prisma.user.findFirst({
      where: { id: input.ownerId, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, firstName: true, lastName: true, orgUnitId: true },
    });
    if (!owner) {
      throw new BadRequestException({
        title: 'Unknown user',
        detail: 'The selected owner is not an active user.',
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id },
        data: {
          ownerId: owner.id,
          // The lead follows its owner into their org unit, so branch-scoped
          // reporting stays consistent after a reassignment.
          orgUnitId: owner.orgUnitId ?? lead.orgUnitId,
          lastActivityAt: new Date(),
          updatedById: user.id,
        },
      });
      await tx.activity.create({
        data: {
          entityType: 'LEAD',
          entityId: id,
          type: 'ASSIGNMENT',
          direction: 'INTERNAL',
          subject: `Assigned to ${owner.firstName} ${owner.lastName}`,
          body: input.note ?? null,
          actorId: user.id,
          isSystemGenerated: true,
        },
      });
      await this.outbox.publish(tx, {
        aggregateType: 'lead',
        aggregateId: id,
        eventType: 'lead.assigned',
        payload: { reference: lead.reference, from: lead.ownerId, to: owner.id },
      });
    });

    await this.audit.record({
      action: 'ASSIGN',
      resource: 'lead',
      resourceId: id,
      changes: { from: lead.ownerId, to: owner.id },
    });

    // The development rotation advances on the allocation, not on viewing the
    // advice — otherwise opening the same lead twice burns the reserved slot
    // and the one-in-four floor quietly never delivers.
    if (lead.score >= STRONG_LEAD_SCORE) {
      await this.allocation.recordStrongAllocation();
    }

    return this.findOne(user, id);
  }

  async bulkAssign(user: AuthenticatedPrincipal, input: BulkAssignLeadInput) {
    if (!this.scope.canAssignTo(user, input.ownerId)) {
      throw new ForbiddenException({ title: 'Cannot assign to that user' });
    }

    // Filtering by the caller's scope before writing means a caller cannot
    // reassign leads they cannot see by guessing ids. Ids outside scope are
    // silently skipped and reported in the count, not rejected — otherwise the
    // error message confirms which ids exist.
    const inScope = await this.prisma.lead.findMany({
      where: {
        id: { in: input.leadIds },
        deletedAt: null,
        status: { notIn: ['CONVERTED'] },
        AND: [this.scope.leadScope(user)],
      },
      select: { id: true },
    });

    const ids = inScope.map((lead) => lead.id);
    if (ids.length === 0) return { assigned: 0, skipped: input.leadIds.length };

    const owner = await this.prisma.user.findFirst({
      where: { id: input.ownerId, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, firstName: true, lastName: true, orgUnitId: true },
    });
    if (!owner) throw new BadRequestException({ title: 'Unknown user' });

    await this.prisma.$transaction(async (tx) => {
      await tx.lead.updateMany({
        where: { id: { in: ids } },
        data: { ownerId: owner.id, orgUnitId: owner.orgUnitId, updatedById: user.id },
      });
      await tx.activity.createMany({
        data: ids.map((leadId) => ({
          entityType: 'LEAD' as const,
          entityId: leadId,
          type: 'ASSIGNMENT' as const,
          direction: 'INTERNAL' as const,
          subject: `Bulk assigned to ${owner.firstName} ${owner.lastName}`,
          actorId: user.id,
          isSystemGenerated: true,
        })),
      });
    });

    await this.audit.record({
      action: 'ASSIGN',
      resource: 'lead.bulk',
      changes: { ownerId: owner.id, count: ids.length, requested: input.leadIds.length },
    });

    return { assigned: ids.length, skipped: input.leadIds.length - ids.length };
  }

  /**
   * Conversion — the hand-off from CRM to onboarding.
   *
   * Creates the Customer record SIHL ONE owns for engagement purposes and emits
   * `lead.converted`, which is what the onboarding/eKYC integration consumes.
   * SIHL ONE never claims to have opened an account; the back office does that
   * and reports back with a client code.
   */
  async convert(user: AuthenticatedPrincipal, id: string, input: ConvertLeadInput) {
    const lead = await this.mustFindInScope(user, id);

    if (lead.status === 'CONVERTED') {
      throw new BadRequestException({
        title: 'Already converted',
        detail: 'This lead has already been converted to a customer.',
      });
    }
    if (!canTransitionLead(lead.status as LeadStatus, 'CONVERTED')) {
      throw new BadRequestException({
        title: 'Lead is not ready to convert',
        detail: `A lead must be QUALIFIED or at PROPOSAL before conversion. It is currently ${lead.status}.`,
      });
    }

    const existingCustomer = await this.prisma.customer.findFirst({
      where: { pan: input.pan, deletedAt: null },
      select: { id: true, reference: true },
    });
    if (existingCustomer) {
      throw new BadRequestException({
        title: 'Customer already exists',
        detail: `A customer with this PAN already exists (${existingCustomer.reference}). Link the lead to that customer instead.`,
      });
    }

    const reference = await this.references.next('CU');

    // Read once, outside the transaction: the back-office payload needs the
    // partner's own identifiers, not just the foreign key.
    const partner = lead.partnerId
      ? await this.prisma.partner.findUnique({
          where: { id: lead.partnerId },
          select: { reference: true, referralCode: true },
        })
      : null;

    const result = await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          reference,
          firstName: lead.firstName,
          lastName: lead.lastName,
          email: input.email,
          mobile: lead.mobile,
          pan: input.pan,
          city: lead.city,
          state: lead.state,
          pincode: lead.pincode,
          status: 'ONBOARDING',
          kycStatus: 'NOT_STARTED',
          onboardingStage: 'LEAD',
          stageUpdatedAt: new Date(),
          productInterest: lead.productInterest,
          relationshipManagerId: lead.ownerId,
          orgUnitId: lead.orgUnitId,
          partnerId: lead.partnerId,
          createdById: user.id,
        },
      });

      await tx.lead.update({
        where: { id },
        data: {
          status: 'CONVERTED',
          convertedAt: new Date(),
          closedAt: new Date(),
          customerId: customer.id,
          pan: input.pan,
          email: input.email,
          lastActivityAt: new Date(),
          updatedById: user.id,
        },
      });

      await tx.leadStatusHistory.create({
        data: {
          leadId: id,
          fromStatus: lead.status,
          toStatus: 'CONVERTED',
          note: input.note ?? `Converted to customer ${reference}`,
          changedById: user.id,
        },
      });

      await tx.activity.create({
        data: {
          entityType: 'LEAD',
          entityId: id,
          type: 'STATUS_CHANGE',
          direction: 'INTERNAL',
          subject: `Converted to customer ${reference}`,
          body: input.note ?? null,
          actorId: user.id,
          isSystemGenerated: true,
        },
      });

      // Consent given as a lead carries forward to the customer record; the
      // ledger keeps both rows so the chain is provable.
      const leadConsents = await tx.consentRecord.findMany({ where: { leadId: id } });
      if (leadConsents.length) {
        await tx.consentRecord.createMany({
          data: leadConsents.map((consent) => ({
            entityType: 'CUSTOMER' as const,
            entityId: customer.id,
            customerId: customer.id,
            purpose: consent.purpose,
            granted: consent.granted,
            channel: consent.channel,
            consentText: consent.consentText,
            ipAddress: consent.ipAddress,
            userAgent: consent.userAgent,
          })),
        });
      }

      await this.outbox.publish(tx, {
        aggregateType: 'lead',
        aggregateId: id,
        eventType: 'lead.converted',
        payload: {
          leadReference: lead.reference,
          customerId: customer.id,
          customerReference: reference,
          pan: input.pan,
          mobile: lead.mobile,
          email: input.email,
          relationshipManagerId: lead.ownerId,
          // Sourcing, carried to the back office at the moment of hand-off.
          //
          // This is what maps the account to the partner when it is activated.
          // The link existed internally — Customer.partnerId is set above — but
          // it stopped there, so the one system that pays the partner never
          // learned who introduced the client.
          partnerId: lead.partnerId,
          partnerReference: partner?.reference ?? null,
          partnerReferralCode: partner?.referralCode ?? null,
          campaignId: lead.campaignId,
          eventId: lead.eventId,
        },
      });

      return customer;
    });

    await this.audit.record({
      action: 'STATUS_CHANGE',
      resource: 'lead',
      resourceId: id,
      changes: { to: 'CONVERTED', customerId: result.id, customerReference: reference },
    });

    return { customerId: result.id, customerReference: reference, leadId: id };
  }

  async remove(user: AuthenticatedPrincipal, id: string): Promise<void> {
    await this.mustFindInScope(user, id);
    // Soft delete only. A lead is evidence of a marketing spend and of a
    // person's consent; hard-deleting it destroys both records.
    await this.prisma.lead.update({ where: { id }, data: { deletedAt: new Date(), updatedById: user.id } });
    await this.audit.record({ action: 'DELETE', resource: 'lead', resourceId: id });
  }

  // -------------------------------------------------------------------------

  private buildWhere(user: AuthenticatedPrincipal, query: LeadQuery): Record<string, unknown> {
    const and: Record<string, unknown>[] = [this.scope.leadScope(user)];

    if (query.q) {
      const term = query.q.trim();
      and.push({
        OR: [
          { firstName: { contains: term, mode: 'insensitive' } },
          { lastName: { contains: term, mode: 'insensitive' } },
          { mobile: { contains: term } },
          { email: { contains: term, mode: 'insensitive' } },
          { reference: { contains: term, mode: 'insensitive' } },
        ],
      });
    }

    if (query.status?.length) and.push({ status: { in: query.status } });
    if (query.source?.length) and.push({ source: { in: query.source } });
    // `hasSome` is array overlap — the OR semantics the filter advertises.
    // Served by the GIN index on lead.productInterest; without it this is a
    // sequential scan, which is invisible at pilot size and not at scale.
    //
    // The codes arrive already expanded — see `withSubProducts`.
    if (query.productInterest?.length) {
      and.push({ productInterest: { hasSome: query.productInterest } });
    }
    if (query.priority) and.push({ priority: query.priority });
    if (query.ownerId) and.push({ ownerId: query.ownerId });
    if (query.partnerId) and.push({ partnerId: query.partnerId });
    if (query.campaignId) and.push({ campaignId: query.campaignId });
    if (query.minScore !== undefined) and.push({ score: { gte: query.minScore } });
    if (query.overdueOnly) and.push({ nextFollowUpAt: { lt: new Date() } });
    if (query.createdFrom || query.createdTo) {
      and.push({
        createdAt: {
          ...(query.createdFrom ? { gte: query.createdFrom } : {}),
          ...(query.createdTo ? { lte: query.createdTo } : {}),
        },
      });
    }

    return { deletedAt: null, AND: and };
  }

  private async mustFindInScope(user: AuthenticatedPrincipal, id: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, deletedAt: null, AND: [this.scope.leadScope(user)] },
    });
    if (!lead) {
      throw new NotFoundException({
        title: 'Lead not found',
        detail: 'No lead with that id is visible to you.',
      });
    }
    return lead;
  }

  private async assertNoOpenDuplicate(mobile: string): Promise<void> {
    const existing = await this.prisma.lead.findFirst({
      where: {
        mobile,
        deletedAt: null,
        status: { notIn: ['CONVERTED', 'LOST', 'DISQUALIFIED'] },
      },
      select: { reference: true },
    });
    if (existing) {
      throw new BadRequestException({
        title: 'Duplicate lead',
        detail: `An open lead already exists for this mobile number (${existing.reference}). Add your update to that lead instead.`,
        errors: { mobile: [`Already tracked as ${existing.reference}`] },
      });
    }
  }

  private async orgUnitOf(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { orgUnitId: true },
    });
    return user?.orgUnitId ?? null;
  }
}
