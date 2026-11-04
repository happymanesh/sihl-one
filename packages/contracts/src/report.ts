import { z } from 'zod';

import { istDayBoundary } from './daily-activity';

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
/**
 * Whole days between two instants.
 *
 * The floor is the whole point, and leaving it out cost a year of range.
 * `istDayBoundary` widens `from` to the first millisecond of its day and `to`
 * to the *last* — which is right, and is what makes the final day inclusive in
 * every query downstream. But it means the two instants for 1 Jan 2024 to
 * 1 Jan 2025 are 366 days and 23:59:59.999 apart, so a raw division gave
 * 366.99999 and `<= 366` refused exactly the full leap year the limit was
 * written to allow.
 *
 * Counting whole days instead compares the days the caller actually named and
 * ignores the widening, which exists for a different purpose. A caller passing
 * full timestamps rather than plain dates is measured the same way, so asking
 * for 366 days and twelve hours counts as 366 — deliberately, since the limit
 * is there to bound how much of the lead table one query aggregates, and half
 * a day either way does not change that.
 */
function wholeDaysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

export const reportRangeSchema = z
  .object({
    from: istDayBoundary('from').optional(),
    to: istDayBoundary('to').optional(),
  })
  .refine((r) => !r.from || !r.to || r.from <= r.to, {
    message: 'The start of the range must not be after its end',
    path: ['from'],
  })
  .refine((r) => !r.from || !r.to || wholeDaysBetween(r.from, r.to) <= 366, {
    message: 'A report may cover at most 366 days',
    path: ['to'],
  });
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
  /** Their manager's name. Null for somebody with no reporting line mapped. */
  reportingTo: string | null;
  /**
   * The National Head who owns their vertical, found by walking the reporting
   * line up. "No vertical head" when the line never reaches one.
   */
  verticalHead: string | null;
  assigned: number;
  open: number;
  converted: number;
  lost: number;
  /** Percentage, one decimal. Null when nothing was assigned — not zero. */
  conversionRate: number | null;
  activities: number;
  visits: number;
  /**
   * Visits somebody else owned, that this person went along to and was
   * confirmed present at.
   *
   * Counted separately from `visits` and never added to it: credit for a visit
   * stays with its owner, so rolling support into the same column would let two
   * people bank one meeting. It answers a different question — who is being
   * pulled into other people's deals, and whether the product experts are
   * spread too thin.
   */
  joinedOthers: number;
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
