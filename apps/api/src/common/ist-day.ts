/**
 * Days, in the timezone the business works in.
 *
 * Instants are stored in UTC and that is right — one representation in the
 * middle that cannot drift. But a *day* is not an instant, and "today", "the
 * 26th" and "this week" all mean something in Asia/Kolkata and nothing in UTC.
 *
 * Computing them with `setHours` or `toISOString().slice(0, 10)` uses whichever
 * timezone the process happens to run in. The containers run UTC, so a lead
 * created at 02:00 on the 26th was counted on the 25th, a report for "today"
 * began at half past five in the morning, and an audit filter ending "today"
 * ran on until half past five the next.
 *
 * Every day boundary on the server goes through here, so there is one answer
 * rather than one per call site. The web has its own counterpart for values
 * typed into a form; between the two, a timezone is stated only at the edges.
 */

/** Asia/Kolkata is a fixed offset — no daylight saving to account for. */
const IST_OFFSET_MINUTES = 330;
const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60_000;
const IST_SUFFIX = '+05:30';

/**
 * The calendar day an instant falls on here, as `YYYY-MM-DD`.
 *
 * The shape used for grouping and for any date written into an export, so a
 * row and the bucket it was counted in always agree.
 */
export function istDayKey(value: Date): string {
  return new Date(value.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Midnight here, on the day the given instant falls on. */
export function istDayStart(value: Date): Date {
  return new Date(`${istDayKey(value)}T00:00:00.000${IST_SUFFIX}`);
}

/**
 * The last millisecond of that day here.
 *
 * For inclusive ranges — a compliance officer filtering "to today" and seeing
 * nothing from today files a bug report every time.
 */
export function istDayEnd(value: Date): Date {
  return new Date(`${istDayKey(value)}T23:59:59.999${IST_SUFFIX}`);
}

/** Midnight here, today. */
export function istToday(): Date {
  return istDayStart(new Date());
}
