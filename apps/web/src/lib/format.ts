/**
 * Indian-locale formatting.
 *
 * Money is formatted from strings, never numbers: the API sends decimals as
 * strings precisely so nothing does float arithmetic on a rupee value, and
 * parsing to a Number here to format it would reintroduce that.
 */

/** ₹12,34,567 — lakh/crore grouping, which is what an Indian broker reads. */
export function formatCurrency(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const amount = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(amount)) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

/** ₹1.2 Cr / ₹12.3 L — for dashboard tiles where the full number is noise. */
export function formatCompactCurrency(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const amount = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(amount)) return '—';

  if (Math.abs(amount) >= 10_000_000) return `₹${(amount / 10_000_000).toFixed(2)} Cr`;
  if (Math.abs(amount) >= 100_000) return `₹${(amount / 100_000).toFixed(1)} L`;
  if (Math.abs(amount) >= 1_000) return `₹${(amount / 1_000).toFixed(1)} K`;
  return `₹${amount.toFixed(0)}`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-IN').format(value);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * "3 days ago" / "in 2 hours".
 *
 * Deterministic given an explicit `now`, which matters because this renders on
 * the server: without it the string is computed at render time and can differ
 * from what the client would compute, producing a hydration mismatch.
 */
export function formatRelative(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';

  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const absolute = Math.abs(seconds);

  const formatter = new Intl.RelativeTimeFormat('en-IN', { numeric: 'auto' });
  if (absolute < 60) return formatter.format(Math.round(seconds), 'second');
  if (absolute < 3600) return formatter.format(Math.round(seconds / 60), 'minute');
  if (absolute < 86400) return formatter.format(Math.round(seconds / 3600), 'hour');
  if (absolute < 2_592_000) return formatter.format(Math.round(seconds / 86400), 'day');
  if (absolute < 31_536_000) return formatter.format(Math.round(seconds / 2_592_000), 'month');
  return formatter.format(Math.round(seconds / 31_536_000), 'year');
}

/** SCREAMING_SNAKE → Title Case, for enum values shown to users. */
export function humanise(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

/**
 * 1 → "1st", 33 → "33rd", 11 → "11th".
 *
 * The teens are the exception that catches every naive implementation: 11, 12
 * and 13 take "th" despite ending in 1, 2 and 3.
 */
export function ordinal(value: number): string {
  const lastTwo = Math.abs(value) % 100;
  const lastOne = Math.abs(value) % 10;
  const suffix =
    lastTwo >= 11 && lastTwo <= 13
      ? 'th'
      : lastOne === 1
        ? 'st'
        : lastOne === 2
          ? 'nd'
          : lastOne === 3
            ? 'rd'
            : 'th';
  return `${value}${suffix}`;
}
