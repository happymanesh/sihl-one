import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  canMergeLeads,
  maskMobile,
  previewMerge,
  scoreMatch,
  suggestSurvivor,
  type DuplicateGroup,
  type DuplicateQuery,
  type MergeableRecord,
  type MergeLeadsInput,
  type MergePreview,
} from '@sihl-one/contracts';

import { AuditService } from '../../common/audit.service';
import { OutboxService } from '../../common/outbox.service';
import { ScopeService } from '../../common/scope.service';
import type { AuthenticatedPrincipal } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';

/** Ceiling on one detection sweep, so a large book cannot hang the screen. */
const DETECTION_LIMIT = 200;

const LEAD_SELECT = {
  id: true,
  reference: true,
  firstName: true,
  lastName: true,
  mobile: true,
  email: true,
  pan: true,
  city: true,
  state: true,
  pincode: true,
  status: true,
  estimatedValue: true,
  partnerId: true,
  campaignId: true,
  eventId: true,
  ownerId: true,
  customerId: true,
  mergedIntoId: true,
  createdAt: true,
  owner: { select: { id: true, firstName: true, lastName: true } },
} as const;

interface LeadRow {
  id: string;
  reference: string;
  firstName: string;
  lastName: string | null;
  mobile: string;
  email: string | null;
  pan: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  status: string;
  estimatedValue: unknown;
  partnerId: string | null;
  campaignId: string | null;
  eventId: string | null;
  ownerId: string | null;
  customerId: string | null;
  mergedIntoId: string | null;
  createdAt: Date;
  owner: { id: string; firstName: string; lastName: string } | null;
}

/**
 * Finding and merging duplicate leads.
 *
 * The importer already refuses to create a row that definitely matches an
 * existing lead. This covers what the importer cannot: the same person who
 * enquired on the website in March, walked into a branch in June, and was
 * entered again by a different executive — three records, three owners, and
 * nobody aware of the other two.
 *
 * Detection here is on **identity keys only** — same mobile, same email, same
 * PAN. Those are facts. A fuzzy sweep across the whole book (similar name plus
 * same city) is a different job with a different cost profile, and floating
 * "possibly the same" pairs to a reviewer who then has to guess is how a review
 * queue gets abandoned in week two.
 */
@Injectable()
export class DuplicatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async groups(
    user: AuthenticatedPrincipal,
    query: DuplicateQuery,
  ): Promise<{ items: DuplicateGroup[]; total: number; page: number; pageSize: number }> {
    // Scoped: a reviewer can only see — and therefore only merge — leads their
    // data scope already reaches. Cross-branch duplicates surface for whoever
    // can see both, which is the person who should be deciding anyway.
    const where = {
      deletedAt: null,
      mergedIntoId: null,
      AND: [this.scope.leadScope(user)],
    };

    const keys: Array<'MOBILE' | 'EMAIL' | 'PAN'> =
      query.key === 'ANY' ? ['MOBILE', 'EMAIL', 'PAN'] : [query.key];

    const groups: DuplicateGroup[] = [];
    const seen = new Set<string>();

    for (const key of keys) {
      // Written out per key rather than parameterising the column: Prisma's
      // `groupBy` types cannot follow a computed field name, and the version
      // that compiled did so by casting away the very safety that makes the
      // filter correct.
      const values = await this.duplicatedValues(key, where);

      for (const value of values) {
        const leads = await this.prisma.lead.findMany({
          where: {
            ...where,
            ...(key === 'MOBILE'
              ? { mobile: value }
              : key === 'EMAIL'
                ? { email: value }
                : { pan: value }),
          },
          select: LEAD_SELECT,
          orderBy: { createdAt: 'asc' },
        });
        if (leads.length < 2) continue;

        // A pair found by mobile and again by email is one duplicate, not two.
        const fingerprint = leads
          .map((lead) => lead.id)
          .sort()
          .join(':');
        if (seen.has(fingerprint)) continue;
        seen.add(fingerprint);

        groups.push(await this.toGroup(key, value, leads));
      }
    }

    const start = (query.page - 1) * query.pageSize;
    return {
      items: groups.slice(start, start + query.pageSize),
      total: groups.length,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** What the survivor will look like, computed by the same function the write uses. */
  async preview(
    user: AuthenticatedPrincipal,
    survivorId: string,
    duplicateId: string,
  ): Promise<{ preview: MergePreview; eligibility: { ok: boolean; reason: string | null } }> {
    const [survivor, duplicate] = await this.mustFindBoth(user, survivorId, duplicateId);

    return {
      preview: previewMerge(toMergeable(survivor), toMergeable(duplicate)),
      eligibility: canMergeLeads(toMergeable(survivor), toMergeable(duplicate)),
    };
  }

  /**
   * Performs the merge.
   *
   * Everything moves in one transaction: if the activities move but the lead is
   * not closed, the history is on a record nobody will look at again and the
   * duplicate is still live in somebody's queue.
   */
  async merge(user: AuthenticatedPrincipal, input: MergeLeadsInput) {
    const [survivor, duplicate] = await this.mustFindBoth(
      user,
      input.survivorId,
      input.duplicateId,
    );

    const eligibility = canMergeLeads(toMergeable(survivor), toMergeable(duplicate));
    if (!eligibility.ok) {
      throw new BadRequestException({ title: 'Cannot merge', detail: eligibility.reason });
    }

    const preview = previewMerge(toMergeable(survivor), toMergeable(duplicate));
    const gains = Object.fromEntries(
      preview.gains.map((outcome) => [outcome.field, outcome.value]),
    );

    await this.prisma.$transaction(async (tx) => {
      // The duplicate is closed *first*, before the survivor takes anything
      // from it.
      //
      // `lead_active_pan_key` and its mobile equivalent are partial unique
      // indexes over active leads only — raw SQL, so Prisma's types cannot see
      // them and nothing warns. Copying a PAN onto the survivor while the
      // duplicate still holds it and is still active violates the index. Closing
      // first drops the duplicate out of the index and frees the identity, which
      // is also what the merge means: it stops being a live claim on that person.
      await tx.lead.update({
        where: { id: duplicate.id },
        data: {
          mergedIntoId: survivor.id,
          status: 'DISQUALIFIED',
          lostReason: 'DUPLICATE',
          lostNote: `Merged into ${survivor.reference}. ${input.reason}`,
          closedAt: new Date(),
          updatedById: user.id,
        },
      });

      if (Object.keys(gains).length > 0) {
        await tx.lead.update({ where: { id: survivor.id }, data: gains as never });
      }

      // History follows the person, not the record. Leaving activities on the
      // closed duplicate hides half the conversation from the RM who keeps it.
      await tx.activity.updateMany({
        where: { entityType: 'LEAD', entityId: duplicate.id },
        data: { entityId: survivor.id },
      });
      await tx.task.updateMany({
        where: { entityType: 'LEAD', entityId: duplicate.id },
        data: { entityId: survivor.id },
      });
      await tx.document.updateMany({
        where: { entityType: 'LEAD', entityId: duplicate.id },
        data: { entityId: survivor.id },
      });
      // Consent is evidence of what a specific person agreed to, so it moves
      // with them — a DPDP request has to be answerable from one record.
      await tx.consentRecord.updateMany({
        where: { leadId: duplicate.id },
        data: { leadId: survivor.id, entityId: survivor.id },
      });

      await tx.activity.create({
        data: {
          entityType: 'LEAD',
          entityId: survivor.id,
          type: 'NOTE',
          direction: 'INTERNAL',
          subject: `Merged ${duplicate.reference} into this lead`,
          body: input.reason,
          actorId: user.id,
          isSystemGenerated: true,
        },
      });

      await this.outbox.publish(tx, {
        aggregateType: 'lead',
        aggregateId: survivor.id,
        eventType: 'lead.merged',
        payload: {
          survivorReference: survivor.reference,
          mergedReference: duplicate.reference,
          mergedLeadId: duplicate.id,
        },
      });
    });

    await this.audit.record({
      action: 'UPDATE',
      resource: 'lead',
      resourceId: survivor.id,
      reason: input.reason,
      changes: {
        mergedFrom: duplicate.reference,
        gained: preview.gains.map((outcome) => outcome.field),
        // Recorded so a value the merge kept out can still be recovered from
        // the trail rather than only from the closed record.
        discarded: preview.conflicts.map((outcome) => ({
          field: outcome.field,
          value: outcome.discarded,
        })),
      },
    });

    return { survivorId: survivor.id, mergedId: duplicate.id, gains: preview.gains.length };
  }

  /**
   * Values of one identity key held by more than one live lead.
   *
   * Three near-identical branches rather than one parameterised query. Prisma's
   * `groupBy` types cannot follow a computed column name, and the only way to
   * make the generic version compile is a cast that discards the check on the
   * scope filter travelling with it — the one part that must not be wrong.
   */
  private async duplicatedValues(
    key: 'MOBILE' | 'EMAIL' | 'PAN',
    where: Record<string, unknown>,
  ): Promise<string[]> {
    if (key === 'MOBILE') {
      const rows = await this.prisma.lead.groupBy({
        by: ['mobile'],
        where: { ...where, mobile: { not: '' } } as never,
        _count: { _all: true },
        // The count filter nests under the grouped column, not beside it.
        having: { mobile: { _count: { gt: 1 } } },
        orderBy: { mobile: 'asc' },
        take: DETECTION_LIMIT,
      });
      return rows.map((row) => row.mobile).filter((value): value is string => Boolean(value));
    }

    if (key === 'EMAIL') {
      const rows = await this.prisma.lead.groupBy({
        by: ['email'],
        where: { ...where, email: { not: null } } as never,
        _count: { _all: true },
        having: { email: { _count: { gt: 1 } } },
        orderBy: { email: 'asc' },
        take: DETECTION_LIMIT,
      });
      return rows.map((row) => row.email).filter((value): value is string => Boolean(value));
    }

    const rows = await this.prisma.lead.groupBy({
      by: ['pan'],
      where: { ...where, pan: { not: null } } as never,
      _count: { _all: true },
      having: { pan: { _count: { gt: 1 } } },
      orderBy: { pan: 'asc' },
      take: DETECTION_LIMIT,
    });
    return rows.map((row) => row.pan).filter((value): value is string => Boolean(value));
  }

  // -------------------------------------------------------------------------

  private async mustFindBoth(
    user: AuthenticatedPrincipal,
    survivorId: string,
    duplicateId: string,
  ) {
    const scopeFilter = { deletedAt: null, AND: [this.scope.leadScope(user)] };

    const [survivor, duplicate] = await Promise.all([
      this.prisma.lead.findFirst({ where: { id: survivorId, ...scopeFilter }, select: LEAD_SELECT }),
      this.prisma.lead.findFirst({
        where: { id: duplicateId, ...scopeFilter },
        select: LEAD_SELECT,
      }),
    ]);

    // 404 rather than 403 on either: confirming a lead exists but is out of
    // reach is itself a disclosure, and merging is exactly the operation
    // somebody would use to probe for one.
    if (!survivor || !duplicate) {
      throw new NotFoundException({
        title: 'Lead not found',
        detail: 'Both leads must be within your data scope to be merged.',
      });
    }

    return [survivor, duplicate] as const;
  }

  private async toGroup(
    key: 'MOBILE' | 'EMAIL' | 'PAN',
    value: string,
    leads: LeadRow[],
  ): Promise<DuplicateGroup> {
    const counts = await this.prisma.activity.groupBy({
      by: ['entityId'],
      where: { entityType: 'LEAD', entityId: { in: leads.map((lead) => lead.id) } },
      _count: { _all: true },
      orderBy: { entityId: 'asc' },
    });
    const activityByLead = new Map(counts.map((row) => [row.entityId, row._count._all]));

    const enriched = leads.map((lead) => ({
      ...lead,
      activityCount: activityByLead.get(lead.id) ?? 0,
    }));

    const [first, second] = enriched as [typeof enriched[0], typeof enriched[0]];
    const suggestion = suggestSurvivor(toMergeable(first), toMergeable(second));

    // Scored only to explain the grouping to the reviewer. The grouping itself
    // is an exact identity-key match, so this never decides anything.
    const scored = scoreMatch(
      {
        firstName: first.firstName,
        lastName: first.lastName,
        mobile: first.mobile,
        email: first.email,
        pan: first.pan,
        city: first.city,
      },
      {
        id: second.id,
        firstName: second.firstName,
        lastName: second.lastName,
        mobile: second.mobile,
        email: second.email,
        pan: second.pan,
        city: second.city,
      },
    );

    return {
      key,
      // The raw key never reaches the browser. A duplicate queue that prints
      // full mobile numbers is a nicely paginated export of the customer book.
      keyLabel:
        key === 'MOBILE'
          ? maskMobile(value)
          : key === 'EMAIL'
            ? maskEmail(value)
            : `${value.slice(0, 3)}****${value.slice(-1)}`,
      leads: enriched.map((lead) => ({
        id: lead.id,
        reference: lead.reference,
        fullName: `${lead.firstName} ${lead.lastName ?? ''}`.trim(),
        mobileMasked: maskMobile(lead.mobile),
        email: lead.email,
        status: lead.status,
        score: scored.score,
        owner: lead.owner
          ? {
              id: lead.owner.id,
              fullName: `${lead.owner.firstName} ${lead.owner.lastName}`.trim(),
            }
          : null,
        createdAt: lead.createdAt.toISOString(),
        activityCount: lead.activityCount,
        customerId: lead.customerId,
      })),
      signals: scored.signals,
      suggestedSurvivorId: suggestion.survivor.id,
      suggestedBecause: suggestion.because,
    };
  }
}

function maskEmail(value: string): string {
  const [local = '', domain = ''] = value.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}

function toMergeable(lead: LeadRow & { activityCount?: number }): MergeableRecord {
  return {
    ...lead,
    createdAt: lead.createdAt.toISOString(),
    // Decimal to string: the merge only ever compares and copies this value,
    // and comparing Decimal instances by `String()` elsewhere would silently
    // treat 5000 and 5000.00 as different.
    estimatedValue: lead.estimatedValue === null ? null : String(lead.estimatedValue),
    activityCount: lead.activityCount ?? 0,
  };
}
