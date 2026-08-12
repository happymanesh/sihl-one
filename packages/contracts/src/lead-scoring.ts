import type { LeadSource, ProductInterest } from './enums';

/**
 * Deterministic lead scoring — the Phase 1 stand-in for the ML model.
 *
 * Why a rules engine first, and why it lives in `contracts`:
 *
 *  1. There is no training data yet. SIHL ONE is the system that will *produce*
 *     the labelled outcomes (lead → converted/lost) a model needs. Shipping a
 *     model before the data exists would mean shipping someone's guesses with a
 *     probability attached, which is worse than shipping transparent rules.
 *  2. The interface below (`ScoringFeatures` in, `LeadScore` out) is exactly
 *     what a model endpoint will expose. When `POST /ai/lead-score` goes live it
 *     replaces the body of `scoreLead`, not its callers.
 *  3. Every factor is returned with its contribution, so an RM can be told
 *     *why* a lead is hot. An unexplained score gets ignored by a sales floor.
 *
 * Range is 0–100. The weights are a starting hypothesis to be recalibrated
 * against real conversion data after roughly one quarter of operation.
 */

export interface ScoringFeatures {
  source: LeadSource;
  /** Weight from the source master. Omitted, the shipped table is used. */
  sourceWeight?: number;
  productInterest: readonly ProductInterest[];
  hasEmail: boolean;
  hasPan: boolean;
  hasCity: boolean;
  /** Count of logged interactions of any type. */
  activityCount: number;
  /** Whole days since the lead was created. */
  ageInDays: number;
  /** Whole days since the last logged activity; null when never contacted. */
  daysSinceLastActivity: number | null;
  estimatedValue: number | null;
  /** True when the lead arrived through an attributed marketing campaign. */
  hasCampaignAttribution: boolean;
}

export interface ScoreFactor {
  code: string;
  label: string;
  points: number;
}

export interface LeadScore {
  score: number;
  factors: ScoreFactor[];
}

/**
 * Intent strength by acquisition channel. A referral or a walk-in is a person
 * who sought SIHL out; an imported list is not.
 */
/** Fallback when no weight is supplied — mirrors the seeded master exactly. */
export const DEFAULT_SOURCE_WEIGHT = 4;

/**
 * Weights for the sources SIHL ONE shipped with.
 *
 * No longer authoritative: `lead_source.scoringWeight` is, and an administrator
 * can change it. This is the seed for that column and the fallback for a caller
 * that did not look one up. Kept in step with the migration that seeded it.
 */
export const SYSTEM_SOURCE_WEIGHTS: Record<string, number> = {
  REFERRAL: 22,
  WALK_IN: 20,
  PARTNER: 18,
  INBOUND_CALL: 18,
  WEBSITE: 14,
  CAMPAIGN: 12,
  SOCIAL: 8,
  OUTBOUND_CALL: 6,
  IMPORT: 2,
  OTHER: 4,
};

/**
 * Revenue intent by product. Derivatives and PMS/AIF customers carry materially
 * higher lifetime value than a single-product equity account.
 */
const PRODUCT_WEIGHTS: Partial<Record<ProductInterest, number>> = {
  PMS: 10,
  AIF: 10,
  DERIVATIVES: 8,
  ALGO: 8,
  NRI: 7,
  EQUITY: 5,
  MUTUAL_FUNDS: 5,
  COMMODITY: 4,
  CURRENCY: 4,
  IPO: 3,
  BONDS: 3,
  INSURANCE: 2,
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export function scoreLead(features: ScoringFeatures): LeadScore {
  const factors: ScoreFactor[] = [];

  // The weight the caller read from the master wins. Falling back to the
  // shipped table keeps scoring working for anything that has not been taught
  // to look one up yet, rather than silently scoring every lead as average.
  const sourcePoints =
    features.sourceWeight ?? SYSTEM_SOURCE_WEIGHTS[features.source] ?? DEFAULT_SOURCE_WEIGHT;
  factors.push({
    code: 'SOURCE',
    label: `Source: ${features.source.toLowerCase().replace(/_/g, ' ')}`,
    points: sourcePoints,
  });

  // Product interest is capped so that ticking every box cannot game the score.
  const productPoints = clamp(
    features.productInterest.reduce((sum, product) => sum + (PRODUCT_WEIGHTS[product] ?? 2), 0),
    0,
    20,
  );
  if (productPoints > 0) {
    factors.push({
      code: 'PRODUCT_INTEREST',
      label: `${features.productInterest.length} product interest(s)`,
      points: productPoints,
    });
  }

  // Contactability. A lead we cannot reach cannot convert, whatever else is true.
  let completenessPoints = 0;
  if (features.hasEmail) completenessPoints += 6;
  if (features.hasPan) completenessPoints += 10;
  if (features.hasCity) completenessPoints += 3;
  if (completenessPoints > 0) {
    factors.push({
      code: 'PROFILE_COMPLETENESS',
      label: 'Profile completeness',
      points: completenessPoints,
    });
  }

  // Engagement, with diminishing returns — five calls is not five times one call.
  const engagementPoints = clamp(Math.round(Math.log2(features.activityCount + 1) * 8), 0, 20);
  if (engagementPoints > 0) {
    factors.push({
      code: 'ENGAGEMENT',
      label: `${features.activityCount} interaction(s)`,
      points: engagementPoints,
    });
  }

  if (features.hasCampaignAttribution) {
    factors.push({ code: 'CAMPAIGN', label: 'Attributed to a campaign', points: 4 });
  }

  if (features.estimatedValue && features.estimatedValue > 0) {
    // ₹1L ≈ +2, ₹10L ≈ +6, ₹1Cr ≈ +10. Log scale keeps one big number from dominating.
    const valuePoints = clamp(Math.round(Math.log10(features.estimatedValue) * 2 - 2), 0, 10);
    if (valuePoints > 0) {
      factors.push({ code: 'DEAL_VALUE', label: 'Estimated value', points: valuePoints });
    }
  }

  // Decay. Leads go stale; an untouched 30-day-old lead is not a hot lead.
  const staleDays = features.daysSinceLastActivity ?? features.ageInDays;
  if (staleDays > 7) {
    const decay = -clamp(Math.round((staleDays - 7) * 0.8), 0, 25);
    factors.push({ code: 'RECENCY_DECAY', label: `${staleDays} days without contact`, points: decay });
  } else if (staleDays <= 2) {
    factors.push({ code: 'RECENCY_FRESH', label: 'Contacted in the last 48 hours', points: 6 });
  }

  const total = factors.reduce((sum, factor) => sum + factor.points, 0);
  return { score: clamp(Math.round(total), 0, 100), factors };
}

/**
 * Next Best Action — the same argument as scoring: explicit rules now, a model
 * later behind an unchanged signature. Ordered by urgency; callers take the head.
 */
export interface NextBestAction {
  code: string;
  title: string;
  reason: string;
  urgency: 'LOW' | 'MEDIUM' | 'HIGH';
}

export function nextBestActions(
  features: ScoringFeatures,
  context: { status: string; hasOwner: boolean; followUpOverdue: boolean },
): NextBestAction[] {
  const actions: NextBestAction[] = [];

  if (!context.hasOwner) {
    actions.push({
      code: 'ASSIGN_OWNER',
      title: 'Assign a relationship manager',
      reason: 'Unassigned leads have no one accountable for the first call.',
      urgency: 'HIGH',
    });
  }

  if (context.followUpOverdue) {
    actions.push({
      code: 'OVERDUE_FOLLOW_UP',
      title: 'Follow-up is overdue',
      reason: 'The committed follow-up date has passed.',
      urgency: 'HIGH',
    });
  }

  if (features.activityCount === 0) {
    actions.push({
      code: 'FIRST_CALL',
      title: 'Make the first contact call',
      reason: 'No interaction has been logged since this lead arrived.',
      urgency: 'HIGH',
    });
  }

  if (!features.hasPan && context.status === 'QUALIFIED') {
    actions.push({
      code: 'COLLECT_PAN',
      title: 'Collect PAN to start eKYC',
      reason: 'A qualified lead cannot move to onboarding without a PAN.',
      urgency: 'MEDIUM',
    });
  }

  if (!features.hasEmail) {
    actions.push({
      code: 'COLLECT_EMAIL',
      title: 'Capture an email address',
      reason: 'Email is required for account statements and e-sign delivery.',
      urgency: 'MEDIUM',
    });
  }

  if (features.productInterest.length === 0) {
    actions.push({
      code: 'QUALIFY_INTEREST',
      title: 'Qualify product interest',
      reason: 'No product interest recorded, so nothing can be recommended.',
      urgency: 'MEDIUM',
    });
  }

  const staleDays = features.daysSinceLastActivity ?? features.ageInDays;
  if (staleDays > 14 && features.activityCount > 0) {
    actions.push({
      code: 'RE_ENGAGE',
      title: 'Re-engage a cooling lead',
      reason: `No contact for ${staleDays} days.`,
      urgency: 'LOW',
    });
  }

  return actions;
}
