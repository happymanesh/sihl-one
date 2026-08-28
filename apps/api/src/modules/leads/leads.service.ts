import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  canTransferLeads,
  closedSince,
  isOpenLeadProductStatus,
  OPEN_LEAD_PRODUCT_STATUSES,
  rollUpLeadStatus,
  canTransitionLead,
  LEAD_STATUS_TRANSITIONS,
  maskPan,
  nextBestActions,
  scoreBandFor,
  STRONG_LEAD_SCORE,
  verificationSurvivesEdit,
  type AssignLeadInput,
  type ChangeLeadProductStatusInput,
  type ClosedPeriod,
  type ConvertProductInput,
  type CheckLeadMobileInput,
  type LeadProductStatus,
  type LeadProductView,
  type DuplicateLeadMatch,
  type TransferLeadInput,
  type BulkAssignLeadInput,
  type ChangeLeadStatusInput,
  type ConvertLeadInput,
  type CreateLeadInput,
  type LeadCaptureInput,
  type LeadListItem,
  type LeadQuery,
  type LeadStatus,
  type LeadProfileInput,
  type LeadProfileView,
  type UpdateLeadInput,
  type VerifyLeadMobileInput,
} from '@sihl-one/contracts';

import { AuditService, diffRecords } from '../../common/audit.service';
import { OutboxService } from '../../common/outbox.service';
import { ReferenceService } from '../../common/reference.service';
import { ScopeService } from '../../common/scope.service';
import { RequestContextStore } from '../../common/request-context';
import { paginate, type AuthenticatedPrincipal, type PaginatedResult } from '../../common/types';
import type { Prisma } from '../../generated/prisma/client';
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
  mobileVerifiedAt: true,
  mobileVerificationMethod: true,
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

/** The three statuses a lead does not come back from without being reopened. */
const CLOSED_LEAD_STATUSES = new Set(['CONVERTED', 'LOST', 'DISQUALIFIED']);

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
   * The board, one card per lead-product.
   *
   * A lead interested in equity, F&O and mutual funds appears three times and
   * each moves independently, which is the whole point of the change: a manager
   * looking at PROPOSAL wants three proposals, not one lead standing in for
   * them. Counting leads instead would put that client in whichever column
   * their furthest product reached and hide the other two conversations.
   *
   * Leads with no products still appear once, under their own status. A lead is
   * a name and a number for its first few days and dropping it off the board
   * until somebody ticks a product is how leads get forgotten.
   */
  async productPipeline(user: AuthenticatedPrincipal, query: LeadQuery) {
    const expanded = await this.withSubProducts(query);
    const where = this.buildWhere(user, { ...expanded, status: undefined });

    const [byProduct, withoutProducts] = await Promise.all([
      this.prisma.leadProduct.groupBy({
        by: ['status'],
        where: { lead: where as Prisma.LeadWhereInput },
        _count: { _all: true },
      }),
      this.prisma.lead.groupBy({
        by: ['status'],
        where: { ...(where as Prisma.LeadWhereInput), products: { none: {} } },
        _count: { _all: true },
      }),
    ]);

    const counts = new Map<string, number>();
    for (const row of [...byProduct, ...withoutProducts]) {
      counts.set(row.status, (counts.get(row.status) ?? 0) + row._count._all);
    }

    return {
      columns: (Object.keys(LEAD_STATUS_TRANSITIONS) as LeadStatus[]).map((status) => ({
        status,
        count: counts.get(status) ?? 0,
      })),
      total: [...counts.values()].reduce((sum, n) => sum + n, 0),
    };
  }

  /**
   * The Closed column: everything finished inside a window.
   *
   * Converted, Lost and Disqualified together rather than three more columns.
   * The board is for work in progress and these are its exhaust; what a manager
   * wants here is "what finished recently and how did it go", which is one list
   * with an outcome on each card.
   *
   * Windowed because closed work is unbounded — every lost product since launch
   * — and a column nobody can reach the bottom of is not a column.
   */
  async closedColumn(user: AuthenticatedPrincipal, period: ClosedPeriod, query: LeadQuery) {
    const expanded = await this.withSubProducts(query);
    const leadWhere = this.buildWhere(user, {
      ...expanded,
      status: undefined,
    }) as Prisma.LeadWhereInput;

    const where: Prisma.LeadProductWhereInput = {
      status: { in: ['CONVERTED', 'LOST', 'DISQUALIFIED'] },
      closedAt: { gte: closedSince(period) },
      lead: leadWhere,
      ...(expanded.productInterest?.length
        ? { productCode: { in: expanded.productInterest } }
        : {}),
    };

    const [rows, total, byOutcome] = await Promise.all([
      this.prisma.leadProduct.findMany({
        where,
        take: query.pageSize,
        skip: (query.page - 1) * query.pageSize,
        orderBy: [{ closedAt: 'desc' }],
        include: {
          product: { select: { name: true } },
          lead: {
            select: {
              id: true,
              reference: true,
              firstName: true,
              lastName: true,
              owner: { select: { firstName: true, lastName: true } },
            },
          },
        },
      }),
      this.prisma.leadProduct.count({ where }),
      // groupBy also insists on ordering by the grouped column.
      this.prisma.leadProduct.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
        orderBy: { status: 'asc' },
      }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        leadId: row.leadId,
        reference: row.lead.reference,
        name: [row.lead.firstName, row.lead.lastName].filter(Boolean).join(' ').trim(),
        productCode: row.productCode,
        productName: row.product?.name ?? row.productCode,
        status: row.status,
        // Two decimals forced: String(Decimal) drops a trailing zero, so
        // 250000.50 comes back as 250000.5 — right numerically, wrong on a page
        // of money.
        finalAmount: row.finalAmount ? row.finalAmount.toFixed(2) : null,
        lostReason: row.lostReason,
        closedAt: row.closedAt?.toISOString() ?? null,
        ownerName: row.lead.owner
          ? `${row.lead.owner.firstName} ${row.lead.owner.lastName}`.trim()
          : null,
      })),
      total,
      byOutcome: Object.fromEntries(byOutcome.map((r) => [r.status, r._count._all])),
    };
  }

  /**
   * One column of the per-product board.
   *
   * Returns lead-products, not leads: the same client appears once for equity
   * and once for F&O, each in whichever column that product has reached. Scoped
   * through the lead, so a rep sees their own book and nobody else's.
   */
  async productBoardColumn(
    user: AuthenticatedPrincipal,
    status: string,
    query: LeadQuery,
  ) {
    const expanded = await this.withSubProducts(query);
    const leadWhere = this.buildWhere(user, {
      ...expanded,
      status: undefined,
    }) as Prisma.LeadWhereInput;

    const where: Prisma.LeadProductWhereInput = {
      status,
      lead: leadWhere,
      ...(expanded.productInterest?.length
        ? { productCode: { in: expanded.productInterest } }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.leadProduct.findMany({
        where,
        take: query.pageSize,
        skip: (query.page - 1) * query.pageSize,
        orderBy: [{ lead: { score: 'desc' } }, { createdAt: 'desc' }],
        include: {
          product: { select: { name: true } },
          lead: {
            select: {
              id: true,
              reference: true,
              firstName: true,
              lastName: true,
              score: true,
              priority: true,
              nextFollowUpAt: true,
              owner: { select: { firstName: true, lastName: true } },
            },
          },
        },
      }),
      this.prisma.leadProduct.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        leadId: row.leadId,
        reference: row.lead.reference,
        name: [row.lead.firstName, row.lead.lastName].filter(Boolean).join(' ').trim(),
        productCode: row.productCode,
        productName: row.product?.name ?? row.productCode,
        status: row.status,
        score: row.lead.score,
        priority: row.lead.priority,
        nextFollowUpAt: row.lead.nextFollowUpAt?.toISOString() ?? null,
        ownerName: row.lead.owner
          ? `${row.lead.owner.firstName} ${row.lead.owner.lastName}`.trim()
          : null,
      })),
      total,
    };
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
        mobileVerifiedBy: { select: { id: true, firstName: true, lastName: true } },
        profile: true,
        familyMembers: { orderBy: { createdAt: 'asc' } },
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
      // Human contact only. A lead does not get warmer because somebody
      // edited it, and activities.service already counts it this way — leaving
      // this one unfiltered meant the same lead scored differently depending on
      // which path last recalculated it.
      this.prisma.activity.count({
        where: { entityType: 'LEAD', entityId: id, isSystemGenerated: false },
      }),
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
      mobileVerifiedAt: lead.mobileVerifiedAt?.toISOString() ?? null,
      mobileVerificationMethod: lead.mobileVerificationMethod,
      mobileVerificationNote: lead.mobileVerificationNote,
      mobileVerifiedBy: lead.mobileVerifiedBy
        ? {
            id: lead.mobileVerifiedBy.id,
            fullName:
              `${lead.mobileVerifiedBy.firstName} ${lead.mobileVerifiedBy.lastName}`.trim(),
          }
        : null,
      profile: this.toProfileView(lead.profile, lead.familyMembers),
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

      // Rows for each product the lead came in wanting. Inside the transaction
      // so a lead never exists with an interest array and no outcomes to match.
      await this.syncLeadProducts(tx, created.id, input.productInterest);

      await this.writeProfile(tx, created.id, user.id, input.profile);

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

    // `profile` is written separately, to its own table — it must not reach the
    // lead row's update payload.
    const { status, attribution, notes, profile: _profile, ...rest } = input;
    if (status && status !== before.status) {
      throw new BadRequestException({
        title: 'Use the status endpoint',
        detail: 'Status changes go through POST /leads/:id/status so the transition is validated.',
      });
    }

    // Editing the number voids any verification against it. Without this the
    // feature is worse than nothing: a rep verifies the number they genuinely
    // called, edits the lead to a different one, and the tick stays — a mark of
    // confidence on a number nobody has ever dialled.
    const keepsVerification = verificationSurvivesEdit(before.mobile, rest.mobile);

    const updated = await this.prisma.lead.update({
      where: { id },
      data: {
        ...rest,
        estimatedValue: rest.estimatedValue ?? undefined,
        updatedById: user.id,
        ...(keepsVerification
          ? {}
          : {
              mobileVerifiedAt: null,
              mobileVerificationMethod: null,
              mobileVerificationNote: null,
              mobileVerifiedById: null,
            }),
      },
    });

    if (input.profile) {
      await this.writeProfile(this.prisma, id, user.id, input.profile);
    }

    if (!keepsVerification && before.mobileVerifiedAt) {
      // Recorded separately from the edit itself: losing a verification is the
      // sort of thing a manager asks about later, and "the number changed" is
      // the answer.
      await this.audit.record({
        action: 'UPDATE',
        resource: 'lead.mobile_verification',
        resourceId: id,
        changes: { cleared: true, reason: 'The mobile number was changed' },
      });
    }

    // Products edited on the lead reconcile into their own rows, and the lead's
    // status is rolled back up from them. Only when the caller actually sent a
    // list — a PATCH that touches only the city must not wipe outcomes.
    if (input.productInterest) {
      await this.prisma.$transaction(async (tx) => {
        await this.syncLeadProducts(tx, id, input.productInterest!, user.id);
      });
    }

    const activityCount = await this.prisma.activity.count({
      where: { entityType: 'LEAD', entityId: id, isSystemGenerated: false },
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

      // Close the product that was taken up, or all of them when no product was
      // named. The lead's own status is not set here: it is rolled up from the
      // products below, so a lead with equity converted and F&O still at
      // proposal correctly stays open instead of vanishing from the pipeline.
      await tx.leadProduct.updateMany({
        where: {
          leadId: id,
          status: { in: [...OPEN_LEAD_PRODUCT_STATUSES] },
          ...(input.productCode ? { productCode: input.productCode } : {}),
        },
        data: { status: 'CONVERTED', closedAt: new Date() },
      });

      await tx.lead.update({
        where: { id },
        data: {
          customerId: customer.id,
          pan: input.pan,
          email: input.email,
          lastActivityAt: new Date(),
          updatedById: user.id,
        },
      });

      // Roll the lead up from its products, then stamp the conversion dates only
      // if that actually made it converted. A lead still working two other
      // products has not converted, however much of a milestone this was.
      await this.rollUpLead(tx, id);

      const rolled = await tx.lead.findUniqueOrThrow({
        where: { id },
        select: { status: true },
      });
      if (rolled.status === 'CONVERTED') {
        await tx.lead.update({
          where: { id },
          data: { convertedAt: new Date(), closedAt: new Date() },
        });
      }

      await tx.leadStatusHistory.create({
        data: {
          leadId: id,
          fromStatus: lead.status,
          toStatus: rolled.status,
          note:
            input.note ??
            (input.productCode
              ? `${input.productCode} converted — customer ${reference}`
              : `Converted to customer ${reference}`),
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
    // Unverified is the side worth hunting for, and it is the NULL side, so it
    // cannot be expressed as an equality.
    if (query.mobileVerified !== undefined) {
      and.push(
        query.mobileVerified
          ? { mobileVerifiedAt: { not: null } }
          : { mobileVerifiedAt: null },
      );
    }
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

  /**
   * Record that someone has actually reached the person behind this number.
   *
   * Only the lead's owner may do it, and that restriction is the point rather
   * than an oversight: this is a statement that *you* made contact, and a
   * manager ticking it on someone else's lead would record a conversation that
   * never happened. It also keeps the unverified rate attributable to the
   * person whose leads they are.
   */
  async verifyMobile(user: AuthenticatedPrincipal, id: string, input: VerifyLeadMobileInput) {
    const lead = await this.mustFindInScope(user, id);

    if (lead.ownerId !== user.id) {
      throw new ForbiddenException({
        title: 'Only the lead owner can confirm the number',
        detail:
          'This records that you reached the client yourself. Ask the assigned relationship manager to confirm it.',
      });
    }

    if (lead.status === 'CONVERTED') {
      throw new BadRequestException({
        title: 'Converted leads are read-only',
        detail: 'The number is confirmed at account opening.',
      });
    }

    await this.prisma.lead.update({
      where: { id },
      data: {
        mobileVerifiedAt: new Date(),
        mobileVerificationMethod: input.method,
        mobileVerificationNote: input.note ?? null,
        mobileVerifiedById: user.id,
      },
    });

    await this.audit.record({
      action: 'UPDATE',
      resource: 'lead.mobile_verification',
      resourceId: id,
      // The number itself is deliberately not written here: the lead row holds
      // it, and the audit table is read by more people than the lead is.
      changes: { method: input.method, verified: true },
    });

    return this.findOne(user, id);
  }

  /**
   * Withdraw a verification.
   *
   * Allowed because people make mistakes, and a tick that cannot be undone is a
   * tick nobody trusts. Audited, so withdrawing one is not a way to quietly
   * rewrite history.
   */
  async unverifyMobile(user: AuthenticatedPrincipal, id: string) {
    const lead = await this.mustFindInScope(user, id);

    if (lead.ownerId !== user.id) {
      throw new ForbiddenException({
        title: 'Only the lead owner can change this',
        detail: 'Ask the assigned relationship manager.',
      });
    }

    await this.prisma.lead.update({
      where: { id },
      data: {
        mobileVerifiedAt: null,
        mobileVerificationMethod: null,
        mobileVerificationNote: null,
        mobileVerifiedById: null,
      },
    });

    await this.audit.record({
      action: 'UPDATE',
      resource: 'lead.mobile_verification',
      resourceId: id,
      changes: { verified: false, reason: 'Withdrawn by the owner' },
    });

    return this.findOne(user, id);
  }

  /**
   * Writes the client profile, if one was supplied.
   *
   * Absent means "this request said nothing about the profile", which must not
   * be confused with "clear it" — a rep editing a lead's city would otherwise
   * wipe the income and family somebody else spent weeks gathering. Only fields
   * actually present are written.
   *
   * The household is replaced wholesale rather than diffed. A family is a short
   * list edited as a unit; matching rows by identity would buy nothing and
   * would leave orphans whenever somebody reordered them.
   */
  private async writeProfile(
    tx: Prisma.TransactionClient,
    leadId: string,
    userId: string,
    profile: LeadProfileInput | undefined,
  ): Promise<void> {
    if (!profile) return;

    const { familyMembers, ...fields } = profile;

    const hasProfileFields = Object.values(fields).some(
      (value) => value !== undefined && !(Array.isArray(value) && value.length === 0),
    );

    if (hasProfileFields) {
      const data = {
        occupation: fields.occupation ?? null,
        companyName: fields.companyName ?? null,
        designation: fields.designation ?? null,
        riskCategory: fields.riskCategory ?? null,
        monthlyIncome: fields.monthlyIncome ?? null,
        annualIncomeBand: fields.annualIncomeBand ?? null,
        monthlySip: fields.monthlySip ?? null,
        monthlyEmi: fields.monthlyEmi ?? null,
        investmentGoal: fields.investmentGoal ?? null,
        existingInvestments: fields.existingInvestments ?? [],
        insuranceCover: fields.insuranceCover ?? null,
        mediclaimBand: fields.mediclaimBand ?? null,
        otherInvestments: fields.otherInvestments ?? null,
        updatedById: userId,
      };

      await tx.leadProfile.upsert({
        where: { leadId },
        create: { leadId, ...data },
        update: data,
      });
    }

    if (familyMembers) {
      await tx.leadFamilyMember.deleteMany({ where: { leadId } });
      if (familyMembers.length > 0) {
        await tx.leadFamilyMember.createMany({
          data: familyMembers.map((member) => ({
            leadId,
            relation: member.relation,
            name: member.name ?? null,
            occupation: member.occupation ?? null,
            location: member.location ?? null,
            maritalStatus: member.maritalStatus ?? null,
          })),
        });
      }
    }
  }

  /** Shapes the stored profile for the wire. Money leaves as strings. */
  private toProfileView(
    profile: {
      occupation: string | null;
      companyName: string | null;
      designation: string | null;
      riskCategory: string | null;
      monthlyIncome: unknown;
      annualIncomeBand: string | null;
      monthlySip: unknown;
      monthlyEmi: unknown;
      investmentGoal: string | null;
      existingInvestments: string[];
      insuranceCover: unknown;
      mediclaimBand: string | null;
      otherInvestments: string | null;
      updatedAt: Date;
    } | null,
    family: Array<{
      id: string;
      relation: string;
      name: string | null;
      occupation: string | null;
      location: string | null;
      maritalStatus: string | null;
    }>,
  ): LeadProfileView | null {
    if (!profile && family.length === 0) return null;

    // Two decimals forced: String(Decimal) drops a trailing zero, so 45000.50
    // would come back as '45000.5' — right as a number, wrong on a page of
    // money.
    const money = (value: unknown): string | null =>
      value === null || value === undefined ? null : (value as { toFixed(n: number): string }).toFixed(2);

    return {
      occupation: profile?.occupation ?? null,
      companyName: profile?.companyName ?? null,
      designation: profile?.designation ?? null,
      riskCategory: (profile?.riskCategory as LeadProfileView['riskCategory']) ?? null,
      monthlyIncome: money(profile?.monthlyIncome),
      annualIncomeBand: (profile?.annualIncomeBand as LeadProfileView['annualIncomeBand']) ?? null,
      monthlySip: money(profile?.monthlySip),
      monthlyEmi: money(profile?.monthlyEmi),
      investmentGoal: profile?.investmentGoal ?? null,
      existingInvestments: (profile?.existingInvestments ??
        []) as LeadProfileView['existingInvestments'],
      insuranceCover: money(profile?.insuranceCover),
      mediclaimBand: (profile?.mediclaimBand as LeadProfileView['mediclaimBand']) ?? null,
      otherInvestments: profile?.otherInvestments ?? null,
      familyMembers: family.map((member) => ({
        id: member.id,
        relation: member.relation as LeadProfileView['familyMembers'][number]['relation'],
        name: member.name,
        occupation: member.occupation,
        location: member.location,
        maritalStatus:
          member.maritalStatus as LeadProfileView['familyMembers'][number]['maritalStatus'],
      })),
      updatedAt: profile?.updatedAt?.toISOString() ?? null,
    };
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

  /**
   * Tell a rep, while they are still typing, that this number is already ours.
   *
   * Read-only and deliberately not a guard: creating an open duplicate is still
   * refused by `assertNoOpenDuplicate` on write. This exists so the refusal is
   * not the first they hear of it, and so they can see who to talk to rather
   * than being told "no".
   *
   * Closed leads are reported too. A number belonging to a lead marked lost six
   * months ago is not a blocker, but it is worth knowing before the same
   * conversation is started from scratch.
   */
  async checkMobile(
    user: AuthenticatedPrincipal,
    input: CheckLeadMobileInput,
  ): Promise<DuplicateLeadMatch> {
    const existing = await this.prisma.lead.findFirst({
      where: {
        mobile: input.mobile,
        deletedAt: null,
        ...(input.excludeLeadId ? { id: { not: input.excludeLeadId } } : {}),
      },
      // An open lead is the one worth surfacing, so prefer it over a closed one
      // that happens to be newer.
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        reference: true,
        firstName: true,
        lastName: true,
        status: true,
        createdAt: true,
        productInterest: true,
        owner: { select: { firstName: true, lastName: true } },
        ownerId: true,
        orgUnitId: true,
      },
    });

    if (!existing) return { exists: false, visible: false, lead: null };

    // Same scope filter the list uses, applied to this one row. Re-deriving the
    // rule here would be a second place for it to drift.
    const visible = await this.prisma.lead.findFirst({
      where: { id: existing.id, AND: [this.scope.leadScope(user)] },
      select: { id: true },
    });

    if (!visible) {
      // Everything identifying is withheld. See the note on DuplicateLeadMatch:
      // the alternative turns this into a directory of the whole firm's book.
      return { exists: true, visible: false, lead: null };
    }

    return {
      exists: true,
      visible: true,
      lead: {
        id: existing.id,
        reference: existing.reference,
        name: [existing.firstName, existing.lastName].filter(Boolean).join(' ').trim(),
        status: existing.status as LeadStatus,
        ownerName: existing.owner
          ? `${existing.owner.firstName} ${existing.owner.lastName}`.trim()
          : null,
        createdAt: existing.createdAt.toISOString(),
        productInterest: existing.productInterest,
        isOpen: !CLOSED_LEAD_STATUSES.has(existing.status),
      },
    };
  }

  /**
   * Move a lead out of one book and into another, on the record.
   *
   * `assign` stays what a manager does inside their own team. This is the
   * crossing-a-boundary case the sales head asked for: it accepts any active
   * user rather than only the caller's reports, and in exchange the reason is
   * mandatory and lands on the lead's timeline where the next person to open it
   * will see it.
   */
  async transfer(user: AuthenticatedPrincipal, id: string, input: TransferLeadInput) {
    const lead = await this.mustFindInScope(user, id);

    if (!canTransferLeads(user.dataScope)) {
      throw new ForbiddenException({
        title: 'Cannot transfer this lead',
        detail: 'Transferring a lead to another team is done by your manager.',
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
    if (owner.id === lead.ownerId) {
      throw new BadRequestException({
        title: 'Already owned by that person',
        detail: 'Choose someone else, or close this dialog.',
      });
    }

    const previousOwner = lead.ownerId
      ? await this.prisma.user.findUnique({
          where: { id: lead.ownerId },
          select: { firstName: true, lastName: true },
        })
      : null;
    const fromName = previousOwner
      ? `${previousOwner.firstName} ${previousOwner.lastName}`.trim()
      : 'nobody';

    await this.prisma.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id },
        data: {
          ownerId: owner.id,
          // The lead follows its owner, so branch reporting stays consistent.
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
          subject: `Transferred from ${fromName} to ${owner.firstName} ${owner.lastName}`.trim(),
          body: input.reason,
          actorId: user.id,
          isSystemGenerated: true,
        },
      });
      await this.outbox.publish(tx, {
        aggregateType: 'lead',
        aggregateId: id,
        eventType: 'lead.transferred',
        payload: { reference: lead.reference, from: lead.ownerId, to: owner.id },
      });
    });

    // Recorded as ASSIGN rather than a new action: a transfer is an assignment
    // that crossed a team boundary, and the distinction is already carried by
    // the reason and by the activity subject. A new enum value would have meant
    // migrating a live column for a label.
    await this.audit.record({
      action: 'ASSIGN',
      resource: 'lead',
      resourceId: id,
      reason: input.reason,
    });

    return { id, ownerId: owner.id };
  }


  /**
   * Bring a lead's product rows in line with its `productInterest` array, then
   * roll the lead's own status up from them.
   *
   * Called wherever the array is written. Two sources for the same fact is a
   * drift waiting to happen; this is the one place that reconciles them, and it
   * runs inside the caller's transaction so a lead is never left with an array
   * saying one thing and rows saying another.
   *
   * Removing a product deletes its row only while nothing has happened to it. A
   * product already closed — converted, lost, disqualified — is left in place:
   * that is a recorded outcome, and un-ticking a checkbox should not erase the
   * fact that a client bought something.
   */
  private async syncLeadProducts(
    tx: Prisma.TransactionClient,
    leadId: string,
    codes: readonly string[],
    /**
     * When set, a change to the interest list is written to the timeline.
     *
     * Left unset on creation: the lead's own creation entry already says what
     * it came in wanting, and a second line repeating it is noise. On an edit
     * it is the opposite — what a client is interested in changing is the whole
     * business event, and until now it happened silently, so a rep opening the
     * record could not tell a product had been added or dropped, or by whom.
     */
    actorId?: string,
  ): Promise<void> {
    const wanted = [...new Set(codes)];
    const existing = await tx.leadProduct.findMany({
      where: { leadId },
      select: { productCode: true, status: true },
    });

    const have = new Set(existing.map((row) => row.productCode));
    const toAdd = wanted.filter((code) => !have.has(code));

    const removable = existing
      .filter(
        (row) =>
          !wanted.includes(row.productCode) &&
          isOpenLeadProductStatus(row.status as LeadProductStatus),
      )
      .map((row) => row.productCode);

    if (removable.length > 0) {
      await tx.leadProduct.deleteMany({ where: { leadId, productCode: { in: removable } } });
    }

    if (toAdd.length > 0) {
      await tx.leadProduct.createMany({
        data: toAdd.map((productCode) => ({ leadId, productCode })),
        skipDuplicates: true,
      });
    }

    if (actorId && (toAdd.length > 0 || removable.length > 0)) {
      // Product names rather than codes: the timeline is read by a rep, and
      // "Added PMS" is a sentence where "Added PMS_DISCRETIONARY" is a log line.
      // Falls back to the code if a master row has since been renamed away.
      const names = new Map(
        (
          await tx.product.findMany({
            where: { code: { in: [...toAdd, ...removable] } },
            select: { code: true, name: true },
          })
        ).map((row) => [row.code, row.name]),
      );
      const label = (code: string) => names.get(code) ?? code;

      const parts: string[] = [];
      if (toAdd.length > 0) parts.push(`Added ${toAdd.map(label).join(', ')}`);
      if (removable.length > 0) parts.push(`Removed ${removable.map(label).join(', ')}`);

      await tx.activity.create({
        data: {
          entityType: 'LEAD',
          entityId: leadId,
          type: 'SYSTEM',
          direction: 'INTERNAL',
          subject: 'Products changed',
          body: parts.join(' · '),
          actorId,
          isSystemGenerated: true,
        },
      });
    }

    await this.rollUpLead(tx, leadId);
  }

  /**
   * Recompute the lead's own status from its products.
   *
   * Stored rather than derived on read: the pipeline groups and counts by it.
   * The rule itself lives in the contracts so both apps agree on what a lead
   * with one converted and two open products actually is.
   */
  private async rollUpLead(tx: Prisma.TransactionClient, leadId: string): Promise<void> {
    const rows = await tx.leadProduct.findMany({ where: { leadId }, select: { status: true } });
    const rolled = rollUpLeadStatus(rows.map((row) => row.status as LeadProductStatus));
    if (!rolled) return;

    const lead = await tx.lead.findUnique({ where: { id: leadId }, select: { status: true } });
    if (!lead || lead.status === rolled) return;

    await tx.lead.update({ where: { id: leadId }, data: { status: rolled } });
    await tx.leadStatusHistory.create({
      data: {
        leadId,
        fromStatus: lead.status,
        toStatus: rolled,
        note: 'Rolled up from product outcomes',
      },
    });
  }

  /**
   * Record what happened to one product on a lead.
   *
   * The lead's own status follows, so a rep marking mutual funds disqualified
   * does not have to think about what that means for the lead overall — and
   * cannot get it wrong.
   */
  async changeProductStatus(
    user: AuthenticatedPrincipal,
    id: string,
    input: ChangeLeadProductStatusInput,
  ) {
    await this.mustFindInScope(user, id);

    const row = await this.prisma.leadProduct.findUnique({
      where: { leadId_productCode: { leadId: id, productCode: input.productCode } },
    });
    if (!row) {
      throw new BadRequestException({
        title: 'Not an interest on this lead',
        detail: 'Add the product to the lead before recording an outcome for it.',
      });
    }

    // Converting is not just another status here.
    //
    // It opens the customer record, and it needs the reference the back office
    // knows the client by. Letting this endpoint set CONVERTED produced a
    // converted product with no customer behind it and no PAN or client code to
    // reconcile against — a lead that looks won and is attached to nothing.
    if (input.status === 'CONVERTED') {
      throw new BadRequestException({
        title: 'Use the conversion step',
        detail:
          'Converting a product records the amount and the PAN or client code, and opens the ' +
          'customer record. Choose Converted from the product itself, which asks for them.',
        code: 'USE_CONVERT_ENDPOINT',
      });
    }

    const closing = !isOpenLeadProductStatus(input.status);

    await this.prisma.$transaction(async (tx) => {
      await tx.leadProduct.update({
        where: { id: row.id },
        data: {
          status: input.status,
          lostReason: input.status === 'LOST' ? (input.lostReason ?? null) : null,
          note: input.note ?? row.note,
          closedAt: closing ? new Date() : null,
        },
      });

      await tx.activity.create({
        data: {
          entityType: 'LEAD',
          entityId: id,
          type: 'STATUS_CHANGE',
          direction: 'INTERNAL',
          subject: `${input.productCode}: ${row.status} → ${input.status}`,
          body: input.note ?? null,
          actorId: user.id,
          isSystemGenerated: true,
        },
      });

      await this.rollUpLead(tx, id);
    });

    await this.audit.record({
      action: 'STATUS_CHANGE',
      resource: 'lead',
      resourceId: id,
      reason: `${input.productCode} → ${input.status}`,
    });

    return this.productsFor(user, id);
  }

  /**
   * Close one product as won, recorded against whatever reference the rep has.
   *
   * The dedicated Convert tab still exists and still asks for a PAN and an
   * email, because that path is where a customer record is opened properly.
   * This one is for the far commoner case: the account already exists in the
   * back office, the rep has the client code, and the alternative to accepting
   * it is the conversion never being recorded at all.
   */
  async convertProduct(
    user: AuthenticatedPrincipal,
    id: string,
    input: ConvertProductInput,
  ) {
    const lead = await this.mustFindInScope(user, id);

    const row = await this.prisma.leadProduct.findUnique({
      where: { leadId_productCode: { leadId: id, productCode: input.productCode } },
    });
    if (!row) {
      throw new BadRequestException({
        title: 'Not an interest on this lead',
        detail: 'Add the product to the lead before recording it as converted.',
      });
    }
    if (row.status === 'CONVERTED') {
      throw new BadRequestException({
        title: 'Already converted',
        detail: `${input.productCode} is already recorded as converted on this lead.`,
      });
    }

    const isPan = input.identifierKind === 'PAN';

    await this.prisma.$transaction(async (tx) => {
      await tx.leadProduct.update({
        where: { id: row.id },
        data: {
          status: 'CONVERTED',
          closedAt: new Date(),
          finalAmount: input.finalAmount ?? null,
          conversionRef: input.identifier,
          conversionRefKind: input.identifierKind,
          note: input.note ?? row.note,
        },
      });

      // The customer record is opened by the first conversion and reused by
      // every one after it. One client is one customer however many products
      // they take; a second record would split their history where it matters.
      let customerId = lead.customerId;
      if (!customerId) {
        const reference = await this.references.next('CU');
        const created = await tx.customer.create({
          data: {
            reference,
            firstName: lead.firstName,
            lastName: lead.lastName,
            mobile: lead.mobile,
            email: lead.email,
            pan: isPan ? input.identifier : null,
            clientCode: isPan ? null : input.identifier,
            city: lead.city,
            state: lead.state,
            status: 'ONBOARDING',
            relationshipManagerId: lead.ownerId,
            orgUnitId: lead.orgUnitId,
          },
        });
        customerId = created.id;
        await tx.lead.update({ where: { id }, data: { customerId } });
      } else if (isPan) {
        // A later conversion that arrives with a PAN fills in one the earlier
        // client-code conversion could not supply. Never overwrites a PAN
        // already on record.
        await tx.customer.updateMany({
          where: { id: customerId, pan: null },
          data: { pan: input.identifier },
        });
      }

      await tx.activity.create({
        data: {
          entityType: 'LEAD',
          entityId: id,
          type: 'STATUS_CHANGE',
          direction: 'INTERNAL',
          subject: `${input.productCode} converted`,
          body: input.note ?? null,
          actorId: user.id,
          isSystemGenerated: true,
          metadata: {
            identifierKind: input.identifierKind,
            finalAmount: input.finalAmount ?? null,
          } as never,
        },
      });

      await this.rollUpLead(tx, id);

      const rolled = await tx.lead.findUniqueOrThrow({ where: { id }, select: { status: true } });
      if (rolled.status === 'CONVERTED') {
        await tx.lead.update({
          where: { id },
          data: { convertedAt: new Date(), closedAt: new Date() },
        });
      }
    });

    await this.audit.record({
      action: 'STATUS_CHANGE',
      resource: 'lead',
      resourceId: id,
      reason: `${input.productCode} converted against ${input.identifierKind}`,
    });

    return this.productsFor(user, id);
  }

  /** The lead's products with their outcomes, for the detail panel and board. */
  async productsFor(user: AuthenticatedPrincipal, id: string): Promise<LeadProductView[]> {
    await this.mustFindInScope(user, id);

    const rows = await this.prisma.leadProduct.findMany({
      where: { leadId: id },
      include: { product: { select: { name: true } } },
      orderBy: [{ createdAt: 'asc' }],
    });

    return rows.map((row) => ({
      productCode: row.productCode,
      productName: row.product?.name ?? null,
      status: row.status as LeadProductStatus,
      isOpen: isOpenLeadProductStatus(row.status as LeadProductStatus),
      lostReason: row.lostReason,
      closedAt: row.closedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    }));
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
