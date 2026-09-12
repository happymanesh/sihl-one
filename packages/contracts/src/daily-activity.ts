import { z } from 'zod';

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
  subtotal: Omit<DailyActivityRow, 'userId' | 'fullName' | 'employeeCode' | 'branch' | 'branchCode' | 'manager'>;
}

export interface DailyActivityReport {
  /** The day covered, `YYYY-MM-DD` in IST. */
  date: string;
  /** True when the day is still in progress, so the reader knows it is partial. */
  partial: boolean;
  groups: DailyActivityGroup[];
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
