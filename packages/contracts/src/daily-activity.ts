import { z } from 'zod';

import type { LeadListItem } from './lead';

/**
 * What each person did on one day.
 *
 * Distinct from the by-owner report, which aggregates a range: this answers
 * "who worked yesterday, and who did not", and the empty rows are the point.
 * A manager reading it is looking for the person who needs help, and that
 * person is invisible in a thirty-day total.
 *
 * Every figure counts **work the rep recorded** — a lead they were given, a
 * mobile they verified, a visit they checked into. Nothing here infers
 * presence: no login times, no "last seen", no idle detection. That line is
 * what keeps this management information rather than surveillance, and it is
 * the same line ADR-0007 draws for the visit module.
 */

/**
 * The day to report on, as `YYYY-MM-DD` in IST.
 *
 * A date rather than a timestamp range, because "Tuesday" is what a manager
 * asks for and the conversion to a UTC window is the server's problem. India
 * has no daylight saving, so a day is always exactly the same width.
 */
export const dailyActivityQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .optional(),
});
export type DailyActivityQuery = z.infer<typeof dailyActivityQuerySchema>;

export interface DailyActivityRow {
  userId: string;
  fullName: string;
  employeeCode: string | null;
  /** Where they sit. Always present — every internal user has an org unit. */
  branch: string | null;
  branchCode: string | null;
  /**
   * Who they report to. Frequently null: reporting lines are incomplete, and
   * showing that honestly is better than inventing a team for somebody.
   */
  manager: string | null;

  /**
   * Leads still open in their name at the end of that day — the backlog they
   * were carrying, not something they did.
   *
   * Point-in-time, so it does not belong in the total: adding a standing
   * backlog to a day's actions would make somebody with a hundred untouched
   * leads look like the busiest person in the branch.
   */
  openLeads: number;

  leadsAssigned: number;
  leadsCreated: number;
  mobilesVerified: number;
  leadsUpdated: number;
  visitsDone: number;
  joinedVisits: number;
  converted: number;
  lost: number;

  /** Everything above, added up. Zero is the row worth looking at. */
  total: number;
}

/**
 * A branch, region or zone with its people underneath it.
 *
 * Rolled up by the org unit's materialised path rather than by direct
 * membership. Regions and zones hold no staff of their own — they are
 * containers — so counting only their direct members reports a region with
 * sixteen busy people underneath it as zero, which is worse than not showing
 * it at all.
 */
export interface DailyActivityGroup {
  orgUnitId: string;
  code: string;
  name: string;
  type: string;
  /** Depth in the tree, so a reader can indent without parsing the path. */
  depth: number;
  rows: DailyActivityRow[];
  subtotal: ActivityTotals;
}

/** The countable part of a row, with nobody's name on it. */
export type ActivityTotals = Omit<
  DailyActivityRow,
  'userId' | 'fullName' | 'employeeCode' | 'branch' | 'branchCode' | 'manager'
>;

/** Every countable column, and the two that are not actions. */
export const ACTIVITY_METRICS = [
  'openLeads',
  'leadsAssigned',
  'leadsCreated',
  'mobilesVerified',
  'leadsUpdated',
  'visitsDone',
  'joinedVisits',
  'converted',
  'lost',
] as const;
export type ActivityMetric = (typeof ACTIVITY_METRICS)[number];

export const ACTIVITY_METRIC_LABELS: Record<ActivityMetric, string> = {
  openLeads: 'Open leads',
  leadsAssigned: 'Leads assigned to them',
  leadsCreated: 'Leads they added',
  mobilesVerified: 'Mobiles verified',
  leadsUpdated: 'Leads updated',
  visitsDone: 'Visits checked into',
  joinedVisits: "Joined someone else's visit",
  converted: 'Converted',
  lost: 'Lost or disqualified',
};

/**
 * Column headings, for a table that has to fit ten numbers across.
 *
 * Separate from the long labels rather than truncated from them: "Joined" and
 * "Joined someone…" say different amounts, and a heading that gets cut off
 * mid-word is worse than a short one chosen on purpose. The long label stays as
 * the tooltip.
 */
export const ACTIVITY_METRIC_SHORT_LABELS: Record<ActivityMetric, string> = {
  openLeads: 'Open',
  leadsAssigned: 'Assigned',
  leadsCreated: 'Added',
  mobilesVerified: 'Verified',
  leadsUpdated: 'Updated',
  visitsDone: 'Visits',
  joinedVisits: 'Joined',
  converted: 'Won',
  lost: 'Lost',
};

/** Which cell was clicked. */
export const activityDetailQuerySchema = z.object({
  userId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  metric: z.enum(ACTIVITY_METRICS),
});
export type ActivityDetailQuery = z.infer<typeof activityDetailQuerySchema>;

/** Which metrics resolve to leads. The remaining two resolve to visits. */
export const LEAD_ACTIVITY_METRICS = [
  'openLeads',
  'leadsAssigned',
  'leadsCreated',
  'mobilesVerified',
  'leadsUpdated',
  'converted',
  'lost',
] as const;

export function isLeadMetric(metric: ActivityMetric): boolean {
  return (LEAD_ACTIVITY_METRICS as readonly string[]).includes(metric);
}

/**
 * One visit behind a count.
 *
 * Only visits need this now: every lead metric returns the leads list shape, so
 * drilling into a number lands on the same table as the Leads screen rather
 * than a second, subtly different rendering of the same records.
 */
export interface ActivityDetailRow {
  id: string;
  reference: string;
  title: string;
  subtitle: string | null;
  at: string | null;
  /** Where the record lives, so the list can link straight to it. */
  href: string;
}

export interface ActivityDetail {
  metric: ActivityMetric;
  label: string;
  date: string;
  person: { userId: string; fullName: string; employeeCode: string | null };

  /**
   * The figure the report showed.
   *
   * Can exceed the number of records listed: "leads updated" counts each edit,
   * so ten updates to four leads is ten on the report and four rows here. The
   * page says so rather than letting the two numbers quietly disagree.
   */
  count: number;

  /** Populated for lead metrics; empty for the two visit ones. */
  leads: LeadListItem[];
  /** Populated for visit metrics; empty for lead ones. */
  visits: ActivityDetailRow[];

  /** Records are capped; this says whether anything was left out. */
  truncated: boolean;
}

export interface DailyActivityReport {
  /** The day covered, `YYYY-MM-DD` in IST. */
  date: string;
  /** True when the day is still in progress, so the reader knows it is partial. */
  partial: boolean;
  groups: DailyActivityGroup[];
  /**
   * Everyone in scope, added up once.
   *
   * Not the sum of the group subtotals as far as a reader is concerned — it is
   * the number a national head came for, and it belongs where they can see it
   * without expanding anything.
   */
  overall: ActivityTotals;
  /** People in scope with nothing at all recorded. The actionable list. */
  idleCount: number;
  peopleCount: number;
}

/**
 * Yesterday, in IST.
 *
 * The default deliberately is not today. Today's row is incomplete until the
 * day ends, and a manager acting on a half-written day is acting on noise —
 * a rep who spent the morning at a client site and writes it up at six looks
 * idle at four.
 */
export function defaultActivityDate(now: Date = new Date()): string {
  const ist = new Date(now.getTime() + 5.5 * 3_600_000);
  ist.setUTCDate(ist.getUTCDate() - 1);
  return ist.toISOString().slice(0, 10);
}

/** The IST day as a UTC window, which is what the database stores. */
export function istDayWindow(date: string): { from: Date; to: Date } {
  const from = new Date(`${date}T00:00:00.000+05:30`);
  return { from, to: new Date(from.getTime() + 86_400_000 - 1) };
}
