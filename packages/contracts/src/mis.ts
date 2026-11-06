import { z } from 'zod';

/**
 * Management information for the CEO.
 *
 * One question, asked down the reporting line: who is carrying what, and who
 * has stopped. Everything here is a *rollup* — a manager's row is their whole
 * line, not their own book — because the person reading it manages verticals
 * rather than leads.
 *
 * Deliberately separate from the Performance report. That one answers "how is
 * this rep doing" and is scoped so a rep sees only themselves; this one is
 * structural and exists to be read from the top. Sharing a service would mean
 * one set of filters serving two opposite intentions, which is how a scoped
 * report eventually leaks.
 */

/**
 * No activity for this many days and a person is counted idle.
 *
 * Seven rather than five: a rep who was on leave Monday to Friday is not
 * idle, and a threshold that flags them teaches managers to ignore the
 * column. Seven also means the number reads the same whichever day of the
 * week the report is opened.
 *
 * A constant rather than a setting, until somebody asks for it to differ by
 * team — at which point it becomes a column on the designation, not a global
 * preference.
 */
export const IDLE_AFTER_DAYS = 7;

/**
 * The lead groups, as the business names them.
 *
 * Four, not seven. `CONTACTED`, `QUALIFIED` and `PROPOSAL` are stages of one
 * state — somebody is working it — and a CEO counting them separately is
 * reading the sales team's process rather than the business's position.
 * `LOST` and `DISQUALIFIED` are both "no business", and their difference
 * matters to a rep's conversion rate, not to this report.
 */
export const MIS_LEAD_GROUPS = ['untouched', 'inProgress', 'converted', 'lost'] as const;
export type MisLeadGroup = (typeof MIS_LEAD_GROUPS)[number];

export const MIS_LEAD_GROUP_LABELS: Record<MisLeadGroup, string> = {
  untouched: 'Untouched',
  inProgress: 'In progress',
  converted: 'Converted',
  lost: 'Lost',
};

/** Which lead statuses fall in each group. The one place this is decided. */
export const MIS_GROUP_STATUSES: Record<MisLeadGroup, readonly string[]> = {
  untouched: ['NEW'],
  inProgress: ['CONTACTED', 'QUALIFIED', 'PROPOSAL'],
  converted: ['CONVERTED'],
  lost: ['LOST', 'DISQUALIFIED'],
};

export interface MisCounts {
  untouched: number;
  inProgress: number;
  converted: number;
  lost: number;
  /** The four above. Carried rather than summed, so a row cannot disagree. */
  total: number;
}

/**
 * One row of the tree.
 *
 * A row is a person. `children` is their reporting line, loaded with the
 * tree rather than fetched on expand: the whole structure is a few hundred
 * people, and a request per expand would make the CEO wait to open a row he
 * is going to open every time.
 */
export interface MisTeamRow {
  userId: string;
  name: string;
  employeeCode: string | null;
  designation: string | null;
  /**
   * How deep in the tree, from zero at a vertical head. Carried so a CSV can
   * be read without rebuilding the nesting, and so the screen can indent
   * without counting ancestors.
   */
  level: number;
  reportsTo: string | null;
  /** Everyone in this line including the person themselves. */
  teamSize: number;
  /** Of `teamSize`, how many have done nothing for `IDLE_AFTER_DAYS`. */
  idleCount: number;
  /** The whole line's book. For a leaf, their own. */
  counts: MisCounts;
  /**
   * The most recent activity anywhere in this line, as an IST day.
   *
   * Null for somebody who has never done anything — which reads differently
   * from a date long past, and the screen says so rather than showing a dash
   * that could mean either.
   */
  lastActivityOn: string | null;
  /** Days since `lastActivityOn`. Null when there has never been activity. */
  idleDays: number | null;
  /**
   * A manager's own leads, as a child row, so the children of a row always
   * sum to it exactly.
   *
   * Absent when they own nothing, because a row of zeros under every manager
   * is noise that makes the ones that matter harder to see.
   */
  ownBook: MisCounts | null;
  children: MisTeamRow[];
}

/**
 * What the report could not place, and therefore what the totals would hide.
 *
 * Both are exception reports: each should be zero, and a number here means
 * somebody needs to act rather than that something is going well.
 */
export interface MisExceptions {
  /**
   * Leads the CEO owns personally.
   *
   * He should own none — he is the one National Head who is not a vertical
   * owner, so a lead on his name is one nobody is working.
   */
  chiefOwnBook: MisCounts | null;
  /** Leads with no owner at all. Invisible everywhere else. */
  unassigned: MisCounts;
  /**
   * Leads owned by somebody whose reporting line never reaches the CEO.
   *
   * Should be zero. Anything here is a hole in the hierarchy, and without
   * this the totals would quietly not add up to the book.
   */
  outsideStructure: MisCounts;
}

export interface MisTeamReport {
  /** The IST day this was built for. */
  asOn: string;
  chief: { userId: string; name: string; employeeCode: string | null } | null;
  rows: MisTeamRow[];
  exceptions: MisExceptions;
  /** Every row, every exception, added once. */
  totals: MisCounts;
  /**
   * Distinct leads behind `totals`.
   *
   * Equal to `totals.total` when the hierarchy is sound. It is printed
   * because an expanded tree double-counts by design — a parent contains its
   * children — and anybody adding up a printout needs that stated rather
   * than discovered.
   */
  uniqueLeads: number;
  totalPeople: number;
  totalIdle: number;
  idleAfterDays: number;
}

export const misTeamQuerySchema = z.object({
  /**
   * Narrow to one vertical, by the head's id. Absent means the whole firm.
   *
   * By id rather than name: two people may share a name, and a report that
   * silently picks one of them is worse than one that cannot be filtered.
   */
  verticalHeadId: z.string().min(1).optional(),
});
export type MisTeamQuery = z.infer<typeof misTeamQuerySchema>;

/** Columns of the CSV, in order. One row per person, fully expanded. */
export const MIS_TEAM_CSV_COLUMNS = [
  'Level',
  'Name',
  'Employee code',
  'Designation',
  'Reports to',
  'Team',
  'Idle',
  'Untouched',
  'In progress',
  'Converted',
  'Lost',
  'Total leads',
  'Last activity',
  'Idle days',
] as const;

// ---------------------------------------------------------------------------
// CEO overview
// ---------------------------------------------------------------------------

/**
 * How far back the trends reach.
 *
 * Twelve of each: a quarter is too short to show a trend and two years is a
 * history lesson. Twelve weeks also means the current week is always visible
 * beside the same week of the previous quarter.
 */
export const OVERVIEW_WEEKS = 12;
export const OVERVIEW_MONTHS = 12;

/** One bucket of a trend. */
export interface MisTrendPoint {
  /** Machine key — `2026-W45` or `2026-11`. Stable, and never displayed. */
  period: string;
  /** What a person reads on the axis: `10 Nov` or `Nov 26`. */
  label: string;
  created: number;
  /**
   * Leads converted *in* this bucket, whenever they were created.
   *
   * A rep who closes January's lead in March is counted in March, which is
   * when the work happened. It also means `converted` is not a subset of this
   * bucket's `created`, so the two series must never be stacked — the gap
   * between them is not a funnel, and drawing it as one would invite exactly
   * that reading.
   */
  converted: number;
}

/** One vertical, for the comparison. */
export interface MisVerticalSummary {
  userId: string;
  name: string;
  counts: MisCounts;
  /** Percentage to one decimal, or null when the vertical holds no leads. */
  conversionRate: number | null;
  teamSize: number;
  idleCount: number;
}

/**
 * A headline figure and its movement.
 *
 * The direction is carried rather than inferred from the sign, because for
 * `idlePeople` a rise is bad and for everything else it is good — and a tile
 * that colours by sign alone gets one of them backwards.
 */
export interface MisHeadline {
  value: number;
  previous: number;
  /** Null when the previous period was zero: a change from nothing is not a %. */
  changePercent: number | null;
  /** Whether the movement is good news, for colour *and* wording. */
  better: boolean | null;
}

export interface MisOverview {
  asOn: string;
  /** The IST month these headlines cover, e.g. `November 2026`. */
  periodLabel: string;
  leadsCreated: MisHeadline;
  converted: MisHeadline;
  /** Percentage points, one decimal — not a count. */
  conversionRate: { value: number | null; previous: number | null; better: boolean | null };
  idlePeople: MisHeadline;
  weekly: MisTrendPoint[];
  monthly: MisTrendPoint[];
  verticals: MisVerticalSummary[];
  idleAfterDays: number;
}
