/**
 * Times typed into a form, turned into instants that mean the same thing
 * everywhere.
 *
 * A `datetime-local` field yields `2026-09-26T14:30` and a `date` field yields
 * `2026-09-26`. Neither carries a timezone, so whoever parses the value applies
 * their own clock. The servers run UTC, so half past two in the afternoon was
 * stored as 14:30Z and read back — correctly, in IST — as eight in the evening.
 * Every save shifted it again.
 *
 * The database stores UTC, which is right. The mistake was never saying which
 * timezone the typed figure was in, so the conversion into UTC never happened.
 *
 * One helper, used by every form that collects a time, so the answer cannot
 * differ from screen to screen.
 */

/** The business runs in one timezone; this is it. */
export const IST_OFFSET = '+05:30';

/** `2026-09-26T14:30` from a datetime-local field. */
const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
/** `2026-09-26` from a date field. */
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A form value as an instant, stated in the business timezone.
 *
 * Returns undefined for an empty field, so an optional input stays optional.
 * A value that already carries an offset, or is not one of the two shapes a
 * browser produces, is passed through untouched — better to hand the API
 * something it can reject than to mangle a format we did not expect.
 *
 * Seconds are included because an offset without them is not valid ISO to every
 * parser, and a silently unparsed date becomes "now".
 */
export function istInstant(value: FormDataEntryValue | string | null): string | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  if (LOCAL_DATETIME.test(raw)) return `${raw}:00${IST_OFFSET}`;
  // A bare date means the start of that day here, not the start of it in UTC —
  // which would be half past five the previous morning.
  if (LOCAL_DATE.test(raw)) return `${raw}T00:00:00${IST_OFFSET}`;
  return raw;
}

/**
 * The same, from a separate date field and time field.
 *
 * Joined here rather than in a component so one place decides what
 * "26 September, 2pm" means. Two fields that travel separately are two fields
 * that can disagree, and the result is a talk at midnight on the wrong day.
 */
export function istInstantFrom(
  date: FormDataEntryValue | string | null,
  time: FormDataEntryValue | string | null,
): string | undefined {
  const day = String(date ?? '').trim();
  const clock = String(time ?? '').trim();
  if (!day || !clock) return undefined;
  return istInstant(`${day}T${clock}`);
}

/** Asia/Kolkata is a fixed offset — no daylight saving to account for. */
const IST_OFFSET_MS = 330 * 60_000;

/**
 * The calendar day an instant falls on here, as `YYYY-MM-DD`.
 *
 * The counterpart of the server's `istDayKey`. Used wherever a day is named
 * rather than an instant — the date on a downloaded file, the day a report
 * covers, the day a picker steps to. Computed with `toISOString()` it would be
 * the UTC day, so anything between midnight and half past five here would be
 * labelled with yesterday's date.
 */
export function istDayKey(value: Date = new Date()): string {
  return new Date(value.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}
