import { z } from 'zod';

/**
 * Sales reporting.
 *
 * Every figure here is derived from leads and their per-product outcomes, and
 * every one is filtered by the caller's data scope before it is counted. A
 * branch manager and the national sales head call the same endpoint and get
 * different numbers, which is the property that lets one report serve everyone
 * instead of one report per rank.
 *
 * Consistent with ADR-0002: this is a system of engagement, not of record.
 * Nothing here is brokerage, ledger or payout. Value figures are the reps' own
 * estimates entered against a lead, so they are labelled as estimates wherever
 * they are shown and must never be reconciled against the back office.
 */

/**
 * The window a report covers.
 *
 * Bounded at 366 days deliberately. These queries aggregate across the whole
 * lead table, and an unbounded range on a growing book turns a report into a
 * table scan that times out — which is how reporting features come to be
 * blamed for slowing down the CRM.
 */
export const reportRangeSchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((r) => !r.from || !r.to || r.from <= r.to, {
    message: 'The start of the range must not be after its end',
    path: ['from'],
  })
  .refine(
    (r) => !r.from || !r.to || (r.to.getTime() - r.from.getTime()) / 86_400_000 <= 366,
    { message: 'A report may cover at most 366 days', path: ['to'] },
  );
export type ReportRange = z.infer<typeof reportRangeSchema>;

/** Default window when the caller names none: the last full 30 days. */
export const DEFAULT_REPORT_DAYS = 30;

export interface ReportPeriod {
  from: string;
  to: string;
  days: number;
}

/**
 * One row of the resource-wise report: what a named person did in the window.
 *
 * `converted` counts leads whose conversion fell inside the window, not leads
 * created inside it that later converted. A rep who closes January's leads in
 * March is credited in March, which is when they did the work.
 */
export interface OwnerReportRow {
  ownerId: string | null;
  ownerName: string;
  employeeCode: string | null;
  branch: string | null;
  assigned: number;
  open: number;
  converted: number;
  lost: number;
  /** Percentage, one decimal. Null when nothing was assigned — not zero. */
  conversionRate: number | null;
  activities: number;
  visits: number;
  overdueFollowUps: number;
  /** Rep-entered estimate, never a booked figure. Decimal string. */
  pipelineValue: string;
}

export interface ProductReportRow {
  productCode: string;
  productName: string;
  interested: number;
  open: number;
  won: number;
  lost: number;
  conversionRate: number | null;
}

export interface SourceReportRow {
  source: string;
  leads: number;
  converted: number;
  lost: number;
  conversionRate: number | null;
  pipelineValue: string;
}

export interface StatusReportRow {
  status: string;
  leads: number;
  /** Share of the scoped total, one decimal. */
  share: number;
}

export interface BranchReportRow {
  orgUnitId: string | null;
  branch: string;
  leads: number;
  converted: number;
  conversionRate: number | null;
  people: number;
  pipelineValue: string;
}

export interface ReportSummary {
  period: ReportPeriod;
  leadsCreated: number;
  leadsConverted: number;
  leadsLost: number;
  openLeads: number;
  conversionRate: number | null;
  pipelineValue: string;
  activities: number;
  visits: number;
  overdueFollowUps: number;
  unassigned: number;
  /** How many people the caller's scope actually covers, so a number has context. */
  peopleInScope: number;
}

export interface SalesReport {
  summary: ReportSummary;
  byOwner: OwnerReportRow[];
  byProduct: ProductReportRow[];
  bySource: SourceReportRow[];
  byStatus: StatusReportRow[];
  byBranch: BranchReportRow[];
}

/**
 * A percentage to one decimal, or null when the denominator is zero.
 *
 * Null rather than 0: a rep with no leads assigned has no conversion rate, and
 * showing them 0% puts them bottom of a table they were never in. The
 * difference matters when the table is used in an appraisal.
 */
export function rate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}
