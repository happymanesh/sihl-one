import { z } from 'zod';

import { idSchema, paginationQuerySchema } from './common';

/**
 * Campaigns and attribution.
 *
 * SIHL ONE does not send anything yet — there is no email or WhatsApp delivery
 * behind this. What it does own is **the campaign as a unit of spend and the
 * attribution loop that closes against it**: leads already carry `campaignId`
 * and the UTM parameters captured once at creation, so the question "did that
 * ₹4 lakh produce anything" is answerable today, before any sending exists.
 *
 * That ordering is deliberate. A campaign builder that cannot report on itself
 * is a worse product than a report with no builder: the first spends money it
 * cannot account for, the second accounts for money spent elsewhere.
 */

export const CAMPAIGN_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'RUNNING',
  'PAUSED',
  'COMPLETED',
  'ARCHIVED',
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_CHANNELS = [
  'EMAIL',
  'SMS',
  'WHATSAPP',
  'PUSH',
  'SOCIAL',
  'SEARCH',
  'DISPLAY',
  'OFFLINE',
  'REFERRAL',
] as const;
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];

/**
 * Which status changes are allowed.
 *
 * A campaign that has been completed cannot quietly go back to running — the
 * spend and the attributed leads have already been reported against it. Reopen
 * by creating the next campaign, which is also what the finance side expects.
 */
export const CAMPAIGN_STATUS_TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  DRAFT: ['SCHEDULED', 'RUNNING', 'ARCHIVED'],
  SCHEDULED: ['RUNNING', 'DRAFT', 'ARCHIVED'],
  RUNNING: ['PAUSED', 'COMPLETED'],
  PAUSED: ['RUNNING', 'COMPLETED', 'ARCHIVED'],
  COMPLETED: ['ARCHIVED'],
  ARCHIVED: [],
};

export function canTransitionCampaign(from: CampaignStatus, to: CampaignStatus): boolean {
  return CAMPAIGN_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * The code that appears in `utm_campaign` on a landing page URL.
 *
 * Constrained to URL-safe characters because that is literally where it ends
 * up. Accepting spaces here produces a link that works until somebody copies it
 * out of an email client.
 */
export const campaignCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(60)
  .regex(
    /^[a-z0-9][a-z0-9._-]*$/,
    'Use lowercase letters, numbers, dots, hyphens and underscores',
  );

export const createCampaignSchema = z
  .object({
    name: z.string().trim().min(3).max(160),
    code: campaignCodeSchema,
    objective: z.string().trim().max(200).optional(),
    channels: z.array(z.enum(CAMPAIGN_CHANNELS)).min(1, 'Choose at least one channel').max(9),
    budget: z.number().min(0).max(10_000_000_000).optional(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    ownerId: idSchema.optional(),
  })
  .refine((input) => !input.startsAt || !input.endsAt || input.endsAt >= input.startsAt, {
    message: 'The end date cannot be before the start date',
    path: ['endsAt'],
  });
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const updateCampaignSchema = z
  .object({
    name: z.string().trim().min(3).max(160).optional(),
    objective: z.string().trim().max(200).nullable().optional(),
    channels: z.array(z.enum(CAMPAIGN_CHANNELS)).min(1).max(9).optional(),
    budget: z.number().min(0).max(10_000_000_000).nullable().optional(),
    actualSpend: z.number().min(0).max(10_000_000_000).nullable().optional(),
    startsAt: z.coerce.date().nullable().optional(),
    endsAt: z.coerce.date().nullable().optional(),
    ownerId: idSchema.nullable().optional(),
  })
  // The code is deliberately not updatable. It is embedded in live links and in
  // every lead already attributed; changing it orphans that history silently.
  .refine((input) => !input.startsAt || !input.endsAt || input.endsAt >= input.startsAt, {
    message: 'The end date cannot be before the start date',
    path: ['endsAt'],
  });
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;

export const changeCampaignStatusSchema = z.object({
  status: z.enum(CAMPAIGN_STATUSES),
});
export type ChangeCampaignStatusInput = z.infer<typeof changeCampaignStatusSchema>;

export const campaignQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(120).optional(),
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  channel: z.enum(CAMPAIGN_CHANNELS).optional(),
});
export type CampaignQuery = z.infer<typeof campaignQuerySchema>;

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

export interface CampaignPerformanceInput {
  leads: number;
  qualified: number;
  converted: number;
  /** Estimated business value of converted leads attributed to this campaign. */
  convertedValue: number;
  spend: number | null;
  budget: number | null;
}

export interface CampaignPerformance {
  leads: number;
  qualified: number;
  converted: number;
  conversionRate: number;
  qualificationRate: number;
  /** Cost per lead. Null when no spend is recorded — not zero. */
  costPerLead: number | null;
  costPerAcquisition: number | null;
  /** Rupees of attributed *business*, which is not the same as revenue. */
  attributedValue: number;
  /**
   * Attributed business value per rupee spent.
   *
   * Deliberately **not** called return on spend. `estimatedValue` on a lead is
   * the size of the business the client is expected to bring — portfolio value
   * or turnover — not brokerage earned on it. Dividing that by marketing spend
   * produces impressive-looking multiples (75× on a real seeded campaign) that
   * mean nothing as profitability, and a marketing budget renewed on the
   * strength of one is a decision made on a number nobody checked.
   *
   * SIHL ONE does not know brokerage; the back office does (ADR-0002). So this
   * is published as what it is — a scale ratio — and the screen never calls it
   * a return.
   */
  attributedValuePerRupee: number | null;
  budgetUsedPercent: number | null;
  /** Factual read of the numbers above. Descriptive, never a recommendation. */
  verdict: string;
  /** Why the figures should be treated carefully, if they should. */
  caveat: string | null;
}

/** Below this many leads, ratios are noise rather than signal. */
export const MIN_LEADS_FOR_VERDICT = 15;

const round = (value: number, places = 1): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/**
 * Turns raw counts into the numbers a marketing lead actually argues about.
 *
 * Two rules run through this:
 *
 * Every cost metric returns `null` rather than `0` when spend is unknown. Zero
 * is a claim — "this campaign was free" — and a dashboard that makes that claim
 * will get a campaign renewed on the strength of it.
 *
 * The verdict describes, it does not recommend. "Worth continuing" requires a
 * cost-per-acquisition benchmark that SIHL has not set here, and inventing a
 * threshold would put a machine's opinion where a marketing head's judgement
 * belongs.
 */
export function computeCampaignPerformance(
  input: CampaignPerformanceInput,
): CampaignPerformance {
  const { leads, qualified, converted, convertedValue, spend, budget } = input;

  const conversionRate = leads > 0 ? round((converted / leads) * 100) : 0;
  const qualificationRate = leads > 0 ? round((qualified / leads) * 100) : 0;

  const hasSpend = spend !== null && spend > 0;
  const costPerLead = hasSpend && leads > 0 ? round(spend / leads, 0) : null;
  const costPerAcquisition = hasSpend && converted > 0 ? round(spend / converted, 0) : null;
  const attributedValuePerRupee = hasSpend ? round(convertedValue / spend, 2) : null;

  const budgetUsedPercent =
    budget !== null && budget > 0 && spend !== null ? round((spend / budget) * 100) : null;

  let verdict: string;
  if (leads === 0) {
    verdict = 'No leads attributed yet.';
  } else if (!hasSpend) {
    verdict = `${leads} leads, ${converted} converted (${conversionRate}%). Record the spend to see cost per lead.`;
  } else if (converted === 0) {
    verdict = `${leads} leads at ${formatRupees(costPerLead!)} each. Nothing converted yet, so there is no cost per account.`;
  } else {
    verdict =
      `${leads} leads at ${formatRupees(costPerLead!)} each; ` +
      `${converted} converted at ${formatRupees(costPerAcquisition!)} per account.`;
  }

  // Two separate honesty problems, and the smaller sample is the more dangerous
  // one because the number still looks precise.
  const caveat =
    leads > 0 && leads < MIN_LEADS_FOR_VERDICT
      ? `Based on only ${leads} ${leads === 1 ? 'lead' : 'leads'} — treat these ratios as indicative.`
      : attributedValuePerRupee !== null
        ? 'Attributed business is the expected size of the clients won, not brokerage earned on them.'
        : null;

  return {
    leads,
    qualified,
    converted,
    conversionRate,
    qualificationRate,
    costPerLead,
    costPerAcquisition,
    attributedValue: convertedValue,
    attributedValuePerRupee,
    budgetUsedPercent,
    verdict,
    caveat,
  };
}

/** Indian grouping, for sentences rather than for table cells. */
function formatRupees(value: number): string {
  return `₹${value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export interface CampaignListItem {
  id: string;
  reference: string;
  name: string;
  code: string;
  status: CampaignStatus;
  channels: CampaignChannel[];
  objective: string | null;
  budget: string | null;
  actualSpend: string | null;
  startsAt: string | null;
  endsAt: string | null;
  owner: { id: string; fullName: string } | null;
  leads: number;
  converted: number;
  conversionRate: number;
  createdAt: string;
}

export interface CampaignDetail extends CampaignListItem {
  performance: CampaignPerformance;
  /** Where the attributed leads actually came from, by UTM source. */
  sources: Array<{ source: string; leads: number; converted: number }>;
  pipeline: Array<{ status: string; count: number; value: string }>;
  allowedTransitions: CampaignStatus[];
  /** The link marketing should publish, with attribution already attached. */
  trackingUrl: string;
}

/**
 * Builds the landing-page URL carrying this campaign's attribution.
 *
 * Generated rather than typed by hand: a mistyped `utm_campaign` produces leads
 * that arrive unattributed, and nobody notices until the campaign is being
 * reviewed and the number is zero.
 */
export function campaignTrackingUrl(
  baseUrl: string,
  code: string,
  channel?: CampaignChannel,
): string {
  const url = new URL(baseUrl);
  url.searchParams.set('utm_source', channel ? channel.toLowerCase() : 'campaign');
  url.searchParams.set('utm_medium', channel ? channelMedium(channel) : 'referral');
  url.searchParams.set('utm_campaign', code);
  return url.toString();
}

function channelMedium(channel: CampaignChannel): string {
  switch (channel) {
    case 'EMAIL':
      return 'email';
    case 'SMS':
    case 'WHATSAPP':
    case 'PUSH':
      return 'message';
    case 'SEARCH':
      return 'cpc';
    case 'DISPLAY':
      return 'display';
    case 'SOCIAL':
      return 'social';
    case 'REFERRAL':
      return 'referral';
    case 'OFFLINE':
      return 'offline';
  }
}
