import {
  maskMobile,
  scoreBandFor,
  scoreLead,
  type LeadListItem,
  type ScoringFeatures,
} from '@sihl-one/contracts';

/** Shape the mapper needs; a structural subset of the Prisma Lead row. */
export interface LeadRow {
  id: string;
  reference: string;
  firstName: string;
  lastName: string | null;
  mobile: string;
  email: string | null;
  pan: string | null;
  city: string | null;
  status: string;
  source: string;
  priority: string;
  productInterest: string[];
  score: number;
  estimatedValue: unknown;
  nextFollowUpAt: Date | null;
  lastActivityAt: Date | null;
  createdAt: Date;
  campaignId?: string | null;
  owner?: { id: string; firstName: string; lastName: string } | null;
  partner?: { id: string; name: string } | null;
}

const DAY_MS = 86_400_000;

export function daysBetween(from: Date, to: Date = new Date()): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));
}

/**
 * Money crosses the wire as a string.
 *
 * Prisma returns Decimal objects, and `JSON.stringify` turns those into a
 * JavaScript number — which cannot represent every rupee value exactly. Sending
 * the string keeps the value intact and forces the client to format it
 * deliberately instead of doing float arithmetic on a balance.
 */
export function decimalToString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

export function toLeadListItem(lead: LeadRow): LeadListItem {
  const now = new Date();
  return {
    id: lead.id,
    reference: lead.reference,
    firstName: lead.firstName,
    lastName: lead.lastName,
    fullName: `${lead.firstName} ${lead.lastName ?? ''}`.trim(),
    // Lists always show masked contact details; the full number is returned
    // only by the single-lead endpoint, and that read is audited.
    mobileMasked: maskMobile(lead.mobile),
    email: lead.email,
    city: lead.city,
    status: lead.status as LeadListItem['status'],
    source: lead.source as LeadListItem['source'],
    priority: lead.priority as LeadListItem['priority'],
    productInterest: lead.productInterest,
    score: lead.score,
    scoreBand: scoreBandFor(lead.score),
    estimatedValue: decimalToString(lead.estimatedValue),
    owner: lead.owner
      ? { id: lead.owner.id, fullName: `${lead.owner.firstName} ${lead.owner.lastName}`.trim() }
      : null,
    partner: lead.partner ? { id: lead.partner.id, name: lead.partner.name } : null,
    nextFollowUpAt: lead.nextFollowUpAt?.toISOString() ?? null,
    isOverdue: Boolean(lead.nextFollowUpAt && lead.nextFollowUpAt < now),
    lastActivityAt: lead.lastActivityAt?.toISOString() ?? null,
    createdAt: lead.createdAt.toISOString(),
  };
}

/** Assembles the feature vector the scorer consumes from a persisted lead. */
export function buildScoringFeatures(
  lead: {
    source: string;
    productInterest: string[];
    email: string | null;
    pan: string | null;
    city: string | null;
    estimatedValue: unknown;
    campaignId: string | null;
    createdAt: Date;
    lastActivityAt: Date | null;
  },
  activityCount: number,
  /** From the source master. Omitted, scoring falls back to the shipped table. */
  sourceWeight?: number,
): ScoringFeatures {
  return {
    source: lead.source as ScoringFeatures['source'],
    sourceWeight,
    productInterest: lead.productInterest as ScoringFeatures['productInterest'],
    hasEmail: Boolean(lead.email),
    hasPan: Boolean(lead.pan),
    hasCity: Boolean(lead.city),
    activityCount,
    ageInDays: daysBetween(lead.createdAt),
    daysSinceLastActivity: lead.lastActivityAt ? daysBetween(lead.lastActivityAt) : null,
    estimatedValue: lead.estimatedValue ? Number(lead.estimatedValue) : null,
    hasCampaignAttribution: Boolean(lead.campaignId),
  };
}

export function rescore(
  lead: Parameters<typeof buildScoringFeatures>[0],
  activityCount: number,
  sourceWeight?: number,
): { score: number; scoreFactors: unknown; scoredAt: Date } {
  const result = scoreLead(buildScoringFeatures(lead, activityCount, sourceWeight));
  return { score: result.score, scoreFactors: result.factors, scoredAt: new Date() };
}
