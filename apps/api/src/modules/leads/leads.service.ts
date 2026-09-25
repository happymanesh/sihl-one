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
  LEAD_LOST_REASONS,
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
  type LeadLostReason,
  type LeadProductStatus,
  type LeadProductView,
  type DuplicateLeadMatch,
  type TransferLeadInput,
  type BulkAssignLeadInput,
  type ChangeLeadStatusInput,
  type ConvertLeadInput,
  visitEvidenceRules,
  type CreateLeadInput,
  type InstaLeadInput,
  type InstaLeadResult,
  type LeadCaptureInput,
  type LeadListItem,
  type LeadOwnerFilterOptions,
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
import type {
  OtpChallenge,
  OtpPurpose,
  OtpVerifyResult,
  ResendOtpInput,
  VerifyOtpInput,
} from '@sihl-one/contracts';
import { PresentationsService } from '../presentations/presentations.service';
import { ExistingClientService } from './existing-client.service';
import { OtpService } from './otp.service';
import { CaptureCodeService } from '../events/capture-code.service';
import { MastersService } from '../masters/masters.service';
import { VisitsService } from '../visits/visits.service';
import { AllocationService } from '../performance/allocation.service';
import {
  LEAD_LIST_SELECT,
  buildScoringFeatures,
  decimalToString,
  rescore,
  toLeadListItem,
  type LeadRow,
} from './lead.mapper';

/** The leads-list columns, defined beside the mapper that consumes them. */
const LIST_SELECT = LEAD_LIST_SELECT;

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

/**
 * `04-Sep-26 15:35`, in IST.
 *
 * The server clock is UTC and every rep reading this is in India. A lead
 * captured at 09:00 IST would otherwise be reported as added at 03:30, and the
 * rep would conclude the message was about some other record.
 *
 * Assembled from parts rather than a `dateStyle`, because the format is fixed:
 * two-digit day, short month, two-digit year, 24-hour clock.
 *
 * The month is mapped from its number rather than taken from the locale's short
 * name. `en-GB` renders September as "Sept" — four letters — which breaks the
 * fixed width, and ICU short names have changed between releases before. Only
 * the timezone conversion is delegated to Intl; the wording is ours.
 */
const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function istStamp(when: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(when);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const month = SHORT_MONTHS[Number(part('month')) - 1] ?? part('month');
  return `${part('day')}-${month}-${part('year')} ${part('hour')}:${part('minute')}`;
}

/** Rows one export may contain. A ceiling, so one click cannot exhaust memory. */
const LEAD_EXPORT_MAX_ROWS = 20_000;

/**
 * One CSV cell, escaped and defused.
 *
 * Two separate problems, both silent:
 *
 * **Quoting.** A comma, a quote or a newline inside a value breaks the row into
 * pieces, and a client called `Shah, Manesh` quietly becomes two columns.
 * Everything is quoted and inner quotes doubled, which is what RFC 4180 asks
 * for and what every spreadsheet actually implements.
 *
 * **Formula injection.** A value beginning `=`, `+`, `-`, `@`, tab or carriage
 * return is executed as a formula when the file is opened — so a lead whose
 * name is `=HYPERLINK("http://…")` runs on the machine of whoever exports the
 * book. The fix is a leading apostrophe, which spreadsheets strip on display
 * and never execute. Quoting alone does **not** prevent this: the quotes are
 * consumed by the CSV parser before the formula parser ever sees the value.
 */
function csvCell(value: string): string {
  const risky = /^[=+\-@\t\r]/.test(value);
  const text = risky ? `'${value}` : value;
  return `"${text.replace(/"/g, '""')}"`;
}
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
    private readonly otp: OtpService,
    private readonly masters: MastersService,
    private readonly visits: VisitsService,
    private readonly existingClients: ExistingClientService,
    private readonly presentations: PresentationsService,
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

  async list(
    user: AuthenticatedPrincipal,
    query: LeadQuery,
  ): Promise<PaginatedResult<LeadListItem>> {
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
  async productBoardColumn(user: AuthenticatedPrincipal, status: string, query: LeadQuery) {
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
            fullName: `${lead.mobileVerifiedBy.firstName} ${lead.mobileVerifiedBy.lastName}`.trim(),
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
          ? {
              id: activity.actor.id,
              fullName: `${activity.actor.firstName} ${activity.actor.lastName}`.trim(),
            }
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

    /*
      Resolved before the duplicate check, not after, because both branches need
      it now. A returning client registering at a stall has to be recorded as
      having attended, and that was impossible while the event was only looked
      up on the path that creates a lead.

      Codes in, ids out — see the note further down on why this is never trusted
      from the browser.
    */
    const coded = await this.captureCodes.resolve({
      partnerCode: input.partnerCode,
      eventCode: input.eventCode,
      // The rep's employee code rides in on utm_content, which the public form
      // already collects and already posts. Validated inside the resolver.
      repCode: input.attribution?.utmContent,
    });

    /*
      Do we already bank this person?

      Asked of the back office stand-in, not of our own leads — the two are
      different questions. `existing` below finds somebody who has enquired
      here before; this finds somebody who holds an account and may never have
      enquired at all. Before this, a client of ten years walking up to a stall
      was indistinguishable from a stranger.
    */
    const client = await this.existingClients.lookup(input.mobile);

    const existing = await this.prisma.lead.findFirst({
      where: {
        mobile: input.mobile,
        deletedAt: null,
        status: { notIn: ['CONVERTED', 'LOST', 'DISQUALIFIED'] },
      },
      select: {
        id: true,
        reference: true,
        mobileVerifiedAt: true,
        owner: { select: { firstName: true, lastName: true } },
      },
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

        /*
          They turned up. Recorded here and nowhere else — `lead.eventId` is
          left alone deliberately, because it means "the event that produced
          this lead" and this event did not produce them. Writing it would
          either credit this event with a lead it did not win, or overwrite the
          earlier event that did.

          `skipDuplicates` covers the person who scans the QR twice at the same
          stall, which is one attendance.
        */
        if (coded.eventId) {
          await tx.eventAttendance.createMany({
            data: [{ eventId: coded.eventId, leadId: existing.id, returning: true }],
            skipDuplicates: true,
          });
        }
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

      /*
        Echoed back, not read back.

        The name, mobile and product on the acknowledgement are the ones the
        visitor just typed, never the ones already on file. Reading the stored
        record out to whoever submitted the form would turn this page into a
        lookup: type a number, learn the client's name. The number was already
        enough to tell you a lead exists; it should not also tell you who it is.

        The owner's name is the one exception, and it is deliberate — the person
        at the desk needs to be able to say who will call. It is disclosed for a
        mobile number the submitter already holds.
      */
      /*
        A returning client gets a code too, but only if their number has never
        been proven. Re-verifying a number that is already verified spends money
        and troubles somebody for nothing.
      */
      const repeatChallenge =
        coded.eventId && !existing.mobileVerifiedAt
          ? await this.otp.issue({
              mobile: input.mobile,
              purpose: 'EVENT_REGISTRATION',
              leadId: existing.id,
              ipAddress: context?.ipAddress ?? null,
            })
          : null;

      /*
        The schedule message, for somebody who is sent no code.

        It normally rides on confirming an OTP, because that is the moment a
        number is proven. A visitor whose number was already proven at an
        earlier event is deliberately sent no code — and so never reached that
        moment, and never heard from us at all. Those are the returning clients,
        the people most worth having at a talk.

        Sent after the transaction above has committed, because the attendance
        row it writes is what names the event in the message.
      */
      if (coded.eventId && existing.mobileVerifiedAt) {
        await this.otp.sendEventRegistrationSms(existing.id, input.mobile);
      }

      return {
        reference: existing.reference,
        duplicate: true,
        existingClient: client.known,
        /*
          A returning visitor whose number was proven at an earlier event is
          sent no code today, so there is no verification step to mint a pass
          on the way through. Minted here instead — without it the one group
          most worth a seat at a talk could not book one.
        */
        bookingToken: existing.mobileVerifiedAt
          ? await this.presentations.bookingTokenFor(existing.id)
          : null,
        verification: repeatChallenge,
        firstName: input.firstName,
        lastName: input.lastName || null,
        mobile: input.mobile,
        productInterest: input.productInterest ?? null,
        assignedToName: existing.owner
          ? `${existing.owner.firstName} ${existing.owner.lastName}`.trim()
          : null,
      };
    }

    await this.masters.assertValid({
      source: input.source,
      productInterest: input.productInterest,
    });

    const reference = await this.references.next('LD');

    // `coded` is resolved at the top of this method — ids, never trusted from
    // the browser: this endpoint is unauthenticated, so an id in the payload
    // would let anyone attribute someone else's business to themselves.
    const campaignId =
      coded.campaignId ?? (await this.resolveCampaignId(null, input.attribution?.utmCampaign));

    // The code resolver names a preferred source, but the master list is edited
    // through the admin screen and drifts between environments — `lead.source`
    // is a foreign key, so writing a code that is not there loses the lead to a
    // constraint violation. Fall back through the alternatives to whatever the
    // caller actually sent, which has already been validated above.
    const storedSource =
      (await this.masters.firstUsableSource(
        coded.source,
        // BRANCH_EVENT is the intended label for a stall capture; WALK_IN and
        // PHYSICAL_VISIT are what older master lists call the same thing.
        coded.eventId ? 'WALK_IN' : null,
        coded.eventId ? 'PHYSICAL_VISIT' : null,
      )) ?? input.source;

    // Weighted on the source the lead is actually stored with. Computing it
    // from `input.source` scored every QR scan at an event as though it had
    // come from the website — the form always posts WEBSITE, because the
    // browser does not know what the code resolves to.
    const sourceWeight = await this.masters.weightFor(storedSource);

    const lead = await this.prisma.$transaction(async (tx) => {
      const created = await tx.lead.create({
        data: {
          reference,
          firstName: input.firstName,
          lastName: input.lastName || null,
          mobile: input.mobile,
          email: input.email || null,
          city: input.city ?? null,
          source: storedSource,
          productInterest: input.productInterest,
          campaignId,
          partnerId: coded.partnerId,
          eventId: coded.eventId,
          // A personal QR puts the lead in that rep's name. A common-QR scan
          // arrives unowned, to be handed out deliberately.
          ownerId: coded.suggestedOwnerId,
          capturedById: coded.capturedById,
          // Where it came in. Without this an unowned lead matches no data
          // scope but a super admin's, and the branch that ran the stall never
          // sees its own registrations.
          orgUnitId: coded.orgUnitId,
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
        payload: {
          reference,
          source: input.source,
          utmCampaign: input.attribution?.utmCampaign ?? null,
        },
      });

      // Recorded for a first-time registration too, even though `eventId` on
      // the lead already implies it. "Who did we meet at this event" is then
      // one query against one table rather than a union of two lists whose
      // meanings differ — and the redundancy costs a row.
      if (coded.eventId) {
        // `returning` means "was already on the book when they arrived", and
        // an existing client is exactly that even though this is their first
        // lead. Without this they are counted as a new enquiry on the event's
        // figures, which overstates what the stall actually won.
        await tx.eventAttendance.createMany({
          data: [{ eventId: coded.eventId, leadId: created.id, returning: client.known }],
          skipDuplicates: true,
        });
      }

      /*
        Say so on the lead itself.

        A flag that only ever reaches a count changes nobody's behaviour. The
        rep who opens this lead is about to pitch account opening, and this is
        the line that stops them.
      */
      if (client.known) {
        await tx.activity.create({
          data: {
            entityType: 'LEAD',
            entityId: created.id,
            type: 'NOTE',
            direction: 'INTERNAL',
            subject: 'Existing client',
            body: client.clientCode
              ? `This mobile matches an existing SIHL client (${client.clientCode}). Confirm before discussing a new account.`
              : 'This mobile matches an existing SIHL client. Confirm before discussing a new account.',
            isSystemGenerated: true,
          },
        });
      }

      return created;
    });

    await this.audit.record({
      action: 'CREATE',
      resource: 'lead.capture',
      resourceId: lead.id,
      changes: { reference, source: input.source },
    });

    /*
      The lead is written and committed above. Only now is a code sent.

      That order is the whole point of the design: somebody who fills in the
      form and then loses signal, mistypes their number or wanders off is still
      a person who was interested, and they are on the book either way. The
      verification improves a record that already exists; it never gates
      creating one.
    */
    const challenge = coded.eventId
      ? await this.otp.issue({
          mobile: input.mobile,
          purpose: 'EVENT_REGISTRATION',
          leadId: lead.id,
          ipAddress: context?.ipAddress ?? null,
        })
      : null;

    const assignedTo = coded.suggestedOwnerId
      ? await this.prisma.user.findUnique({
          where: { id: coded.suggestedOwnerId },
          select: { firstName: true, lastName: true },
        })
      : null;

    return {
      reference,
      duplicate: false,
      // Distinct from `duplicate`, which means "we have an open enquiry from
      // this number". Somebody can be one, the other, or both.
      existingClient: client.known,
      // A brand new lead has not proved anything yet, so no pass until the
      // code comes back.
      bookingToken: null,
      firstName: input.firstName,
      lastName: input.lastName || null,
      mobile: input.mobile,
      productInterest: input.productInterest ?? null,
      assignedToName: assignedTo ? `${assignedTo.firstName} ${assignedTo.lastName}`.trim() : null,
      verification: challenge,
    };
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
        // actorId is what lets the notification router stay silent when a rep
        // assigns a lead to themselves. Without it every self-assignment rings
        // its own bell.
        payload: { reference: lead.reference, from: lead.ownerId, to: owner.id, actorId: user.id },
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
    //
    // `ownerId: null` is the important one: this endpoint hands out work nobody
    // holds, and nothing else. Taking a lead off the person who already owns it
    // is a transfer — a different act, with a mandatory reason and its own
    // endpoint, because somebody is losing a relationship they were working.
    // Bulk is exactly where that must not happen by accident: one careless
    // select-all would silently move a hundred live relationships, and the
    // person who lost them finds out when a client calls.
    const inScope = await this.prisma.lead.findMany({
      where: {
        id: { in: input.leadIds },
        deletedAt: null,
        status: { notIn: ['CONVERTED'] },
        ownerId: null,
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

      await this.mirrorConvertedProducts(tx, customer.id, id);

      // Roll the lead up from its products, then stamp the conversion dates only
      // if that actually made it converted. A lead still working two other
      // products has not converted, however much of a milestone this was.
      await this.rollUpLead(tx, id, user.id);

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
    await this.prisma.lead.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: user.id },
    });
    await this.audit.record({ action: 'DELETE', resource: 'lead', resourceId: id });
  }

  // -------------------------------------------------------------------------

  /**
   * Everyone who owns a lead this caller can see.
   *
   * Derived from the leads, not from the user directory. The obvious source was
   * the assignable-users endpoint, but that answers a different question — who
   * may this person hand work *to* — and for a team-scoped manager it returns
   * their own team only. The result was an owner filter that offered a handful
   * of names while the list underneath showed leads owned by dozens of others,
   * with no way to filter to them.
   *
   * Taking the owners from the same scope the list uses means the filter can
   * never offer a name that returns nothing, and never omit one that would.
   *
   * Unowned leads are not represented here; the filter is "whose", and "nobody's"
   * is a different question the list does not currently ask.
   */
  async owners(user: AuthenticatedPrincipal): Promise<LeadOwnerFilterOptions> {
    // The unowned rows come back from the same grouping rather than a second
    // query: "is anything unassigned" is one of the buckets this already
    // counts, and asking twice invites the two answers to disagree.
    const grouped = await this.prisma.lead.groupBy({
      by: ['ownerId'],
      where: { AND: [this.scope.leadScope(user), { deletedAt: null }] },
      _count: { _all: true },
    });

    const hasUnassigned = grouped.some((row) => row.ownerId === null);
    const ids = grouped.map((row) => row.ownerId).filter((id): id is string => Boolean(id));
    if (ids.length === 0) return { items: [], hasUnassigned };

    const people = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true, employeeCode: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });

    return {
      items: people.map((person) => ({
        id: person.id,
        fullName: `${person.firstName} ${person.lastName}`.trim(),
        employeeCode: person.employeeCode,
      })),
      hasUnassigned,
    };
  }

  /**
   * Check the code somebody was sent at registration.
   *
   * Thin on purpose: every decision lives in OtpService, which is also where
   * the attempt cap and the uniform failure wording live. Putting any of it
   * here would mean two places deciding whether a number is proven.
   */
  async verifyCaptureMobile(input: VerifyOtpInput): Promise<OtpVerifyResult> {
    return this.otp.verify(input.verificationId, input.code);
  }

  /**
   * Send the code again.
   *
   * Resolved from the verification id rather than a number, so this cannot be
   * pointed at somebody else's phone. A spent or unknown id returns the same
   * unavailable challenge as a rate-limited one — the caller is public, and the
   * difference is not its business.
   */
  async resendCaptureCode(input: ResendOtpInput): Promise<OtpChallenge> {
    const existing = await this.prisma.mobileOtp.findUnique({
      where: { id: input.verificationId },
      select: { mobile: true, leadId: true, purpose: true },
    });

    if (!existing) {
      return { verificationId: null, expiresInSeconds: 0, maskedMobile: '', sent: false };
    }

    const context = RequestContextStore.get();
    return this.otp.issue({
      mobile: existing.mobile,
      purpose: existing.purpose as OtpPurpose,
      leadId: existing.leadId,
      ipAddress: context?.ipAddress ?? null,
    });
  }

  /**
   * The current view of the lead list, as a CSV.
   *
   * Takes the same query as `list`, so the file matches what the person was
   * looking at when they pressed Export — a filtered screen that exports the
   * whole book is a data-protection incident waiting for an explanation.
   *
   * Scope is applied exactly as it is for the list, so a rep exports their own
   * leads and nobody else's. The permission on the route decides *whether* a
   * person may export; this decides *what*, and the two must not be confused.
   */
  async exportCsv(
    user: AuthenticatedPrincipal,
    query: LeadQuery,
  ): Promise<{ csv: string; rows: number }> {
    const where = this.buildWhere(user, await this.withSubProducts(query));

    const leads = await this.prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      // A ceiling, not a page. Someone exporting the book wants the book, but
      // an unbounded query on a growing table eventually takes the API down
      // for everybody else. The row count is returned so the caller can say so.
      take: LEAD_EXPORT_MAX_ROWS,
      select: {
        reference: true,
        firstName: true,
        lastName: true,
        mobile: true,
        email: true,
        city: true,
        status: true,
        source: true,
        priority: true,
        productInterest: true,
        estimatedValue: true,
        mobileVerifiedAt: true,
        createdAt: true,
        lastActivityAt: true,
        nextFollowUpAt: true,
        owner: { select: { firstName: true, lastName: true, employeeCode: true } },
        event: { select: { name: true } },
        capturedBy: { select: { firstName: true, lastName: true, employeeCode: true } },
      },
    });

    const header = [
      'Reference',
      'First name',
      'Last name',
      'Mobile',
      'Mobile verified',
      'Email',
      'City',
      'Status',
      'Source',
      'Priority',
      'Products',
      'Estimated value',
      'Owner',
      'Owner code',
      'Event',
      'Captured by',
      'Created',
      'Last activity',
      'Next follow-up',
    ];

    const asDate = (value: Date | null): string => (value ? value.toISOString().slice(0, 10) : '');

    const body = leads.map((lead) => [
      lead.reference,
      lead.firstName,
      lead.lastName ?? '',
      lead.mobile,
      lead.mobileVerifiedAt ? 'Yes' : 'No',
      lead.email ?? '',
      lead.city ?? '',
      lead.status,
      lead.source,
      lead.priority,
      (lead.productInterest ?? []).join('; '),
      lead.estimatedValue ? lead.estimatedValue.toString() : '',
      lead.owner ? `${lead.owner.firstName} ${lead.owner.lastName}`.trim() : '',
      lead.owner?.employeeCode ?? '',
      lead.event?.name ?? '',
      lead.capturedBy ? `${lead.capturedBy.firstName} ${lead.capturedBy.lastName}`.trim() : '',
      asDate(lead.createdAt),
      asDate(lead.lastActivityAt),
      asDate(lead.nextFollowUpAt),
    ]);

    /*
      A byte-order mark, so Excel reads this as UTF-8.

      Without it Excel assumes the system codepage and mangles every name with
      a character outside ASCII — which for an Indian client book is a lot of
      them. Nobody reports it as a bug; they just retype the names.
    */
    const csv =
      '\uFEFF' + [header, ...body].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';

    return { csv, rows: leads.length };
  }

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
          // Where the lead came from, not just who they are. The event screen
          // links straight to `/leads?q=<event code>` to show "the leads this
          // stall produced", and that link returned nothing because the search
          // only ever looked at the person. Searching the campaign the same way
          // for the same reason.
          { event: { code: { contains: term, mode: 'insensitive' } } },
          { event: { name: { contains: term, mode: 'insensitive' } } },
          { campaign: { name: { contains: term, mode: 'insensitive' } } },
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
    if (query.eventId) and.push({ eventId: query.eventId });
    if (query.capturedById) and.push({ capturedById: query.capturedById });
    if (query.captured === 'any') and.push({ capturedById: { not: null } });
    if (query.captured === 'none') and.push({ capturedById: null });

    if (query.owned === 'any') and.push({ ownerId: { not: null } });
    if (query.owned === 'none') and.push({ ownerId: null });

    if (query.returningAtEventId) {
      // Recorded on the attendance row, not on the lead: "already on the book
      // when they arrived" is a fact about that visit, and the same person can
      // be new at one event and returning at the next.
      and.push({
        eventAttendances: { some: { eventId: query.returningAtEventId, returning: true } },
      });
    }

    if (query.attendedEventId) {
      // Captured here, or recorded as having turned up. The first covers every
      // event that ran before attendance was recorded at all; without it this
      // list would silently omit the very leads the event is known for.
      and.push({
        OR: [
          { eventId: query.attendedEventId },
          { eventAttendances: { some: { eventId: query.attendedEventId } } },
        ],
      });
    }
    if (query.minScore !== undefined) and.push({ score: { gte: query.minScore } });
    if (query.overdueOnly) {
      // Closed leads are excluded here as they are on the dashboard and in the
      // reports. This filter was the one place that did not, so a converted
      // lead whose old follow-up date had passed still appeared as work
      // outstanding — and the same lead was absent from the count beside it.
      and.push({
        nextFollowUpAt: { lt: new Date() },
        status: { notIn: [...CLOSED_LEAD_STATUSES] },
      });
    }
    // Unverified is the side worth hunting for, and it is the NULL side, so it
    // cannot be expressed as an equality.
    if (query.mobileVerified !== undefined) {
      and.push(
        query.mobileVerified ? { mobileVerifiedAt: { not: null } } : { mobileVerifiedAt: null },
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
      value === null || value === undefined
        ? null
        : (value as { toFixed(n: number): string }).toFixed(2);

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
        payload: {
          reference: lead.reference,
          from: lead.ownerId,
          to: owner.id,
          reason: input.reason,
          actorId: user.id,
        },
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

    await this.rollUpLead(tx, leadId, actorId ?? undefined);
  }

  /**
   * Mirror the lead's converted products onto the customer record.
   *
   * Without this the customer screen could not answer "what did they actually
   * take?", because `customer_product` was declared but never written by
   * anything — so the holdings chips were always empty and the "holds" filter
   * never matched a single client.
   *
   * `sourceSystem` says SIHL_ONE rather than taking the BACKOFFICE default, and
   * that word is doing real work. Per ADR-0002 this system is not the record of
   * what a client holds; it only knows what was sold through its own pipeline.
   * Labelling the row with where it came from keeps that distinction visible
   * when a back-office feed eventually writes alongside it.
   *
   * `skipDuplicates` for the same reason: if a row for this product already
   * exists — from the back office, or from an earlier conversion on the same
   * client — it is left exactly as it was. This adds what is missing and
   * overwrites nothing.
   */
  private async mirrorConvertedProducts(
    tx: Prisma.TransactionClient,
    customerId: string,
    leadId: string,
  ): Promise<void> {
    const converted = await tx.leadProduct.findMany({
      where: { leadId, status: 'CONVERTED' },
      select: { productCode: true, closedAt: true },
    });
    if (converted.length === 0) return;

    await tx.customerProduct.createMany({
      data: converted.map((row) => ({
        customerId,
        product: row.productCode,
        status: 'CONVERTED',
        openedAt: row.closedAt ?? new Date(),
        sourceSystem: 'SIHL_ONE',
      })),
      skipDuplicates: true,
    });
  }

  /**
   * Recompute the lead's own status from its products.
   *
   * Stored rather than derived on read: the pipeline groups and counts by it.
   * The rule itself lives in the contracts so both apps agree on what a lead
   * with one converted and two open products actually is.
   */
  private async rollUpLead(
    tx: Prisma.TransactionClient,
    leadId: string,
    /**
     * Who caused the roll-up.
     *
     * Every other write to `lead_status_history` records an actor; this one did
     * not, so a lead that converted because its last open product was marked
     * won was attributed to nobody. That is the one path a daily activity
     * report most needs to see — the rep did the work, and the row credited
     * no one.
     */
    actorId?: string,
  ): Promise<void> {
    const rows = await tx.leadProduct.findMany({
      where: { leadId },
      select: { status: true, lostReason: true, closedAt: true },
      orderBy: { closedAt: 'desc' },
    });
    const rolled = rollUpLeadStatus(rows.map((row) => row.status as LeadProductStatus));
    if (!rolled) return;

    const lead = await tx.lead.findUnique({
      where: { id: leadId },
      select: { status: true, convertedAt: true, closedAt: true },
    });
    if (!lead || lead.status === rolled) return;

    // Closing the lead has three consequences beyond the status itself, and
    // leaving any of them out makes the record disagree with itself.
    //
    // `nextFollowUpAt` is cleared because a lead nobody is working has nothing
    // to chase. Left in place it kept converted and lost leads sitting in the
    // overdue follow-up list for ever — the reps' most common complaint about
    // the list, and the reason it was being ignored.
    //
    // `convertedAt` and `closedAt` are stamped because the explicit conversion
    // routes already set them, and reporting counts conversions by
    // `convertedAt`. Without this a lead that converted by its last product
    // being marked CONVERTED had the right status and was invisible to every
    // report of conversions in a period.
    const closing = CLOSED_LEAD_STATUSES.has(rolled);

    // A LOST lead must carry a reason — `lead_lost_requires_reason` in the
    // database enforces it. The roll-up never supplied one, so every attempt to
    // close a lead by losing its last product failed the constraint and threw a
    // 500: the products were marked lost but the lead stayed open for ever.
    // The reason is taken from the most recently closed product, which is the
    // one that actually ended the lead.
    // `LeadProduct.lostReason` is a plain string while the lead's is an enum, so
    // the value is checked against the vocabulary rather than trusted. Anything
    // unrecognised falls back to OTHER: a lead that will not close because a
    // product carries a stale reason code is worse than a slightly vague one.
    const productReason = rows.find((row) => row.status === 'LOST' && row.lostReason)?.lostReason;
    const lostReason: LeadLostReason | undefined =
      rolled === 'LOST'
        ? (LEAD_LOST_REASONS as readonly string[]).includes(productReason ?? '')
          ? (productReason as LeadLostReason)
          : 'OTHER'
        : undefined;

    await tx.lead.update({
      where: { id: leadId },
      data: {
        status: rolled,
        ...(lostReason ? { lostReason } : {}),
        ...(closing
          ? {
              nextFollowUpAt: null,
              closedAt: lead.closedAt ?? new Date(),
              // Only on conversion, and never overwritten: the first time they
              // became a client is the date that matters.
              ...(rolled === 'CONVERTED' && !lead.convertedAt ? { convertedAt: new Date() } : {}),
            }
          : {}),
      },
    });
    await tx.leadStatusHistory.create({
      data: {
        leadId,
        fromStatus: lead.status,
        toStatus: rolled,
        note: 'Rolled up from product outcomes',
        changedById: actorId ?? null,
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

      await this.rollUpLead(tx, id, user.id);
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
  async convertProduct(user: AuthenticatedPrincipal, id: string, input: ConvertProductInput) {
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

      /*
        An existing client converting again is the common case, not the edge.

        Both `pan` and `clientCode` are unique on customer, so creating blindly
        whenever *this lead* has no customer threw a unique violation the moment
        the person already existed from any other lead — and because the whole
        conversion is one transaction, the product never reached CONVERTED. The
        rep saw the outcome silently refuse to stick.

        Matching on the identifier the rep supplied is also the right answer on
        its own terms: the comment below has always said one client is one
        customer however many products they take, and the lead's own link is
        only one of the two ways to discover that.
      */
      if (!customerId) {
        const existing = await tx.customer.findFirst({
          where: isPan ? { pan: input.identifier } : { clientCode: input.identifier },
          select: { id: true },
        });
        if (existing) {
          // Many leads may point at one customer since
          // 20260916090000_lead_customer_not_unique, so a returning client is
          // linked from every lead they arrive on rather than only the first.
          customerId = existing.id;
          await tx.lead.update({ where: { id }, data: { customerId } });
        }
      }

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

      // Mirror against the customer this conversion actually resolved to, not
      // the one the lead happens to point at. For a returning client the
      // pointer may be absent — the customer above is still the right place for
      // the product to land, and reading it back from the lead would silently
      // skip the mirror for exactly the people who already own products.
      if (customerId) await this.mirrorConvertedProducts(tx, customerId, id);

      await this.rollUpLead(tx, id, user.id);

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

  /**
   * Insta Lead — capture somebody standing in front of you and start the meeting.
   *
   * Ordered so the irreplaceable thing happens first. The lead is written and
   * committed before the visit is touched and long before a camera opens: a
   * dead battery, a refused permission or a rep who has to walk away then costs
   * a check-in, which can be redone, rather than the client's number, which
   * cannot. It is the same rule the event capture follows.
   *
   * A mobile that already has an open lead attaches to it rather than being
   * refused. The ordinary Add lead form is right to refuse — it is somebody at
   * a desk about to create a duplicate. Here the person is in front of you, and
   * stopping the rep dead to explain a data rule is the worst available answer.
   */
  async instaLead(user: AuthenticatedPrincipal, input: InstaLeadInput): Promise<InstaLeadResult> {
    const existing = await this.prisma.lead.findFirst({
      where: {
        mobile: input.mobile,
        deletedAt: null,
        status: { notIn: ['CONVERTED', 'LOST', 'DISQUALIFIED'] },
      },
      select: {
        id: true,
        reference: true,
        createdAt: true,
        ownerId: true,
        owner: { select: { firstName: true, lastName: true } },
      },
    });

    let leadId: string;
    let leadReference: string;

    if (existing) {
      /*
        Attaching is only possible if the rep can actually see the lead.

        A walk-in whose number already sits with a colleague is common, and
        recording a meeting on a lead outside your scope would be an ABAC hole
        dressed up as a convenience. So this says who has it, which is the one
        thing that lets the rep act — walk over, or call them. The wording
        matches the Add lead form so the two screens do not tell different
        stories about the same number.
      */
      const visible = await this.prisma.lead.findFirst({
        where: { id: existing.id, deletedAt: null, AND: [this.scope.leadScope(user)] },
        select: { id: true },
      });
      if (!visible) {
        const addedOn = istStamp(existing.createdAt);
        const owner = existing.owner
          ? `${existing.owner.firstName} ${existing.owner.lastName}`.trim()
          : null;
        throw new BadRequestException({
          title: 'Already with a colleague',
          detail:
            `This number is already on the book — added ${addedOn} as ${existing.reference}, ` +
            `${owner ? `with ${owner}` : 'unassigned'}. Speak to them rather than starting a ` +
            `second lead for the same person.`,
        });
      }
      leadId = existing.id;
      leadReference = existing.reference;
    } else {
      // WALK_IN by definition. The fallback chain exists because the source
      // master is admin-managed and has drifted between environments before —
      // `lead.source` is a foreign key, so a code that is not there loses the
      // lead to a constraint violation at exactly the wrong moment.
      const source =
        (await this.masters.firstUsableSource('WALK_IN', 'PHYSICAL_VISIT', 'REFERRAL', 'OTHER')) ??
        'OTHER';

      const reference = await this.references.next('LD');
      const created = await this.prisma.lead.create({
        data: {
          reference,
          firstName: input.firstName,
          lastName: input.lastName || null,
          mobile: input.mobile,
          source,
          // Somebody who came to see you today outranks a form filled in last
          // week. The rep can lower it later; nobody ever raises it in time.
          priority: 'HIGH',
          status: 'NEW',
          ownerId: user.id,
          orgUnitId: user.orgUnitId,
          createdById: user.id,
          lastActivityAt: new Date(),
        },
        select: { id: true, reference: true },
      });
      leadId = created.id;
      leadReference = created.reference;

      await this.audit.record({
        action: 'CREATE',
        resource: 'lead',
        resourceId: leadId,
        reason: 'Insta Lead — captured in person',
      });
    }

    // Only now the meeting. Everything above is already committed.
    const visit = await this.visits.plan(user, {
      entityType: 'LEAD',
      entityId: leadId,
      purpose: 'Met in person',
      mode: input.mode,
      attendees: input.attendeeUserId
        ? [{ userId: input.attendeeUserId, role: 'SUPPORT' as const }]
        : undefined,
    });

    /*
      Check in here only when the mode asks for no photograph.

      For a client-site visit the photograph *is* the record — it is what makes
      "I was there" answerable later — so the rep is taken to the camera rather
      than handed a check-in that skipped it. Doing otherwise would mean every
      off-site visit captured this way was unverified, which would hollow out
      the control precisely where it matters most.
    */
    // Read straight from the master. `visitEvidenceRules` treats an unknown
    // mode as the strictest one, so a missing row demands a photo rather than
    // waving the visit through — the safe direction to fail in.
    const mode = await this.prisma.meetingModeMaster.findUnique({
      where: { code: input.mode },
      select: {
        requiresPhoto: true,
        requiresGeo: true,
        requiresLink: true,
        allowsScreenshot: true,
      },
    });
    const rules = visitEvidenceRules(mode);
    let awaitingCheckIn = true;

    if (!rules.photo) {
      await this.visits.checkIn(user, visit.id, {
        latitude: input.latitude,
        longitude: input.longitude,
        accuracy: input.accuracy,
      });
      awaitingCheckIn = false;
    }

    return {
      leadId,
      leadReference,
      visitId: visit.id,
      reusedExistingLead: Boolean(existing),
      awaitingCheckIn,
    };
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
      note: row.note,
      // A string, like every other money figure that crosses the wire: Decimal
      // through JSON.stringify becomes a float, and a float cannot hold every
      // rupee value exactly.
      finalAmount: decimalToString(row.finalAmount),
      conversionRef: row.conversionRef,
      conversionRefKind: row.conversionRefKind,
    }));
  }

  private async assertNoOpenDuplicate(mobile: string): Promise<void> {
    const existing = await this.prisma.lead.findFirst({
      where: {
        mobile,
        deletedAt: null,
        status: { notIn: ['CONVERTED', 'LOST', 'DISQUALIFIED'] },
      },
      select: {
        reference: true,
        createdAt: true,
        owner: { select: { firstName: true, lastName: true } },
      },
    });
    if (existing) {
      // When it was added, and who has it. "Duplicate" alone leaves the rep
      // guessing whether they are colliding with a colleague's live lead or with
      // something captured months ago; the date answers that without them having
      // to go and look, and the owner tells them who to speak to. An unassigned
      // duplicate is said plainly rather than left blank — it is the one case
      // where the rep can simply pick the lead up themselves.
      const addedOn = istStamp(existing.createdAt);
      const owner = existing.owner
        ? `${existing.owner.firstName} ${existing.owner.lastName}`
        : null;
      const withWhom = owner ? `assigned to ${owner}` : 'not yet assigned to anyone';
      throw new BadRequestException({
        title: 'Lead already exists',
        detail:
          `Lead already exists. added on : ${addedOn} (${existing.reference}), ${withWhom}. ` +
          `Add your update to that lead instead.`,
        errors: {
          mobile: [
            `Already exists, added on ${addedOn} as ${existing.reference}, ` +
              `${owner ? `with ${owner}` : 'unassigned'}`,
          ],
        },
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
