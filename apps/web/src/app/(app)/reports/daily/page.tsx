import Link from 'next/link';
import type { DailyActivityReport, DailyActivityRow } from '@sihl-one/contracts';

import { apiFetch } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { formatNumber } from '@/lib/format';
import { DayPicker } from '@/components/reports/DayPicker';

export const metadata = { title: 'Daily activity' };

/**
 * Who did what, on one day.
 *
 * The empty rows are the content. Every other report in this app aggregates a
 * range, which is exactly where a person who has done nothing for a week
 * disappears — their zero is averaged into somebody else's month. Here a blank
 * row is the thing a manager is looking for.
 *
 * Read as "who needs help today" rather than "who is slacking": a rep who spent
 * the day at three client sites and writes it up that evening is blank until
 * they do, which is why the report defaults to yesterday.
 */

const COLUMNS: Array<{ key: keyof DailyActivityRow; label: string; short: string }> = [
  { key: 'leadsAssigned', label: 'Leads assigned to them', short: 'Assigned' },
  { key: 'leadsCreated', label: 'Leads they added', short: 'Added' },
  { key: 'mobilesVerified', label: 'Mobiles verified', short: 'Verified' },
  { key: 'leadsUpdated', label: 'Leads updated', short: 'Updated' },
  { key: 'visitsDone', label: 'Visits checked into', short: 'Visits' },
  { key: 'joinedVisits', label: "Joined someone else's visit", short: 'Joined' },
  { key: 'converted', label: 'Converted', short: 'Won' },
  { key: 'lost', label: 'Lost or disqualified', short: 'Lost' },
];

/** Today in IST. The report's day boundary is IST, not the server's UTC. */
function istToday(): string {
  return new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

function Num({ value, strong }: { value: number; strong?: boolean }) {
  if (value === 0) {
    // A dash, not a nought. A grid of zeros is unreadable, and the eye needs
    // the non-zero figures to stand out rather than the other way round.
    return <span className="text-[var(--color-text-subtle)]">–</span>;
  }
  return <span className={strong ? 'font-semibold' : undefined}>{formatNumber(value)}</span>;
}

export default async function DailyActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireUser();
  const { date } = await searchParams;
  const suffix = date ? `?date=${encodeURIComponent(date)}` : '';
  const report = await apiFetch<DailyActivityReport>(`/reports/daily${suffix}`);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Daily activity</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {report.date} · {formatNumber(report.peopleCount)}{' '}
            {report.peopleCount === 1 ? 'person' : 'people'} in your view ·{' '}
            <span className={report.idleCount > 0 ? 'font-semibold text-warn-600 dark:text-warn-400' : ''}>
              {formatNumber(report.idleCount)} with nothing recorded
            </span>
          </p>
        </div>
        <DayPicker date={report.date} today={istToday()} />
      </header>

      {report.partial ? (
        <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm">
          <strong>Today is still in progress.</strong>{' '}
          <span className="text-[var(--color-text-muted)]">
            Work logged later today will not appear yet — a blank row here does not mean an idle
            day. Yesterday is the complete picture.
          </span>
        </p>
      ) : null}

      {report.groups.length === 0 ? (
        <p className="card p-6 text-sm text-[var(--color-text-muted)]">
          Nobody in your view on this date.
        </p>
      ) : (
        report.groups.map((group) => (
          <section key={group.orgUnitId} className="card overflow-hidden">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-border)] px-5 py-3">
              <div>
                <h2 className="font-semibold">{group.name}</h2>
                <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
                  {group.code} · {group.type.toLowerCase()} · {group.rows.length}{' '}
                  {group.rows.length === 1 ? 'person' : 'people'}
                </p>
              </div>
              <p className="text-xs text-[var(--color-text-muted)]">
                {formatNumber(group.subtotal.total)} actions
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left">
                    <th className="px-4 py-2 text-xs font-medium text-[var(--color-text-muted)]">
                      Name
                    </th>
                    {COLUMNS.map((column) => (
                      <th
                        key={column.key}
                        title={column.label}
                        className="px-3 py-2 text-right text-xs font-medium text-[var(--color-text-muted)]"
                      >
                        {column.short}
                      </th>
                    ))}
                    <th className="px-4 py-2 text-right text-xs font-medium text-[var(--color-text-muted)]">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {group.rows.map((row) => (
                    <tr
                      key={row.userId}
                      className={`border-b border-[var(--color-border)] last:border-0 ${
                        row.total === 0
                          ? 'bg-warn-50/40 dark:bg-warn-900/10'
                          : 'hover:bg-[var(--color-surface-inset)]'
                      }`}
                    >
                      <td className="px-4 py-2">
                        <span className="font-medium">{row.fullName}</span>
                        <span className="block text-xs font-normal text-[var(--color-text-subtle)]">
                          {row.employeeCode ? `${row.employeeCode}` : ''}
                          {row.manager ? `${row.employeeCode ? ' · ' : ''}reports to ${row.manager}` : ''}
                        </span>
                      </td>
                      {COLUMNS.map((column) => (
                        <td key={column.key} className="px-3 py-2 text-right tnum">
                          <Num value={row[column.key] as number} />
                        </td>
                      ))}
                      <td className="px-4 py-2 text-right tnum">
                        <Num value={row.total} strong />
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-[var(--color-surface-muted)] font-semibold">
                    <td className="px-4 py-2 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                      {group.code} total
                    </td>
                    {COLUMNS.map((column) => (
                      <td key={column.key} className="px-3 py-2 text-right tnum">
                        <Num value={group.subtotal[column.key as keyof typeof group.subtotal]} />
                      </td>
                    ))}
                    <td className="px-4 py-2 text-right tnum">
                      <Num value={group.subtotal.total} strong />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}

      <p className="text-xs text-[var(--color-text-subtle)]">
        Counts work recorded in the system — a lead handed over, a mobile verified, a visit
        checked into. It does not track presence, sign-in times or idle periods.{' '}
        <Link href="/reports" className="underline underline-offset-2">
          The period report
        </Link>{' '}
        is the better place to judge a month.
      </p>
    </div>
  );
}
