import Link from 'next/link';
import type { DailyActivityReport } from '@sihl-one/contracts';

import { apiFetch } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { formatNumber } from '@/lib/format';
import { DayPicker } from '@/components/reports/DayPicker';
import { DailyActivityGroup } from '@/components/reports/DailyActivityGroup';
import { ACTIVITY_COLUMNS } from '@/components/reports/activity-columns';

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

/** Today in IST. The report's day boundary is IST, not the server's UTC. */
function istToday(): string {
  return new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
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
    <div className="space-y-4">
      {/*
        Sticky, because this page is long by design — everybody in scope, one
        row each — and the date control is the one thing a reader reaches for
        repeatedly. Scrolling back to the top to move a day is the friction that
        stops a report being used every morning.
      */}
      <header className="sticky top-0 z-20 -mx-4 border-b border-[var(--color-border)] bg-[var(--color-surface)]/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-surface)]/80 sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Daily activity</h1>
            <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
              {report.date} · {formatNumber(report.peopleCount)}{' '}
              {report.peopleCount === 1 ? 'person' : 'people'} ·{' '}
              <span
                className={
                  report.idleCount > 0
                    ? 'font-semibold text-[var(--color-warn-strong)]'
                    : ''
                }
              >
                {formatNumber(report.idleCount)} with nothing recorded
              </span>
            </p>
          </div>
          <DayPicker date={report.date} today={istToday()} />
        </div>

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
        /*
          One table for the whole report, in one scroll pane.

          A table per branch would size its own columns, so "Verified" would sit
          somewhere different in every card — and reading a column down the page,
          which is the whole point of a roll-up, would mean finding the column
          again at every heading. One table, one colgroup, one geometry.

          The pane scrolls rather than the page so the column names can stay
          frozen at its top: sticky resolves against the nearest scroll container,
          so a thead inside an overflow box only freezes if that box is what
          scrolls.
        */
        <div className="card max-h-[calc(100vh-11rem)] overflow-auto">
          <table className="w-full min-w-[60rem] table-fixed text-sm">
            <colgroup>
              {/* Unset, so the name column absorbs whatever is left over. */}
              <col />
              {ACTIVITY_COLUMNS.map((column) => (
                <col key={column.key} className="w-[4.5rem]" />
              ))}
              <col className="w-[5rem]" />
            </colgroup>

            <thead className="sticky top-0 z-10 bg-[var(--color-surface)]">
              <tr className="text-left">
                <th
                  scope="col"
                  className="px-4 py-2 text-xs font-medium text-[var(--color-text-muted)] shadow-[inset_0_-1px_0_var(--color-border)]"
                >
                  Branch and people
                </th>
                {ACTIVITY_COLUMNS.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    title={column.long}
                    className="px-2 py-2 text-right text-xs font-medium text-[var(--color-text-muted)] shadow-[inset_0_-1px_0_var(--color-border)]"
                  >
                    {column.short}
                  </th>
                ))}
                <th
                  scope="col"
                  className="px-4 py-2 text-right text-xs font-medium text-[var(--color-text-muted)] shadow-[inset_0_-1px_0_var(--color-border)]"
                >
                  Total
                </th>
              </tr>
            </thead>

            {/*
              Everyone in scope, first — the number a national head came for,
              before they meet nine branches. In the table rather than in the
              page header so it lands under its own column heading.
            */}
            <tbody>
              <tr className="border-b-2 border-[var(--color-border)] font-semibold">
                <th scope="row" className="px-4 py-2 text-left font-semibold">
                  All branches
                  <span className="block text-xs font-normal text-[var(--color-text-subtle)]">
                    {formatNumber(report.peopleCount)}{' '}
                    {report.peopleCount === 1 ? 'person' : 'people'}
                    {report.idleCount > 0
                      ? ` · ${formatNumber(report.idleCount)} with nothing recorded`
                      : ''}
                  </span>
                </th>
                {ACTIVITY_COLUMNS.map((column) => (
                  <td key={column.key} className="px-2 py-2 text-right tnum">
                    {report.overall[column.key] === 0 ? (
                      <span className="font-normal text-[var(--color-text-subtle)]">–</span>
                    ) : (
                      formatNumber(report.overall[column.key])
                    )}
                  </td>
                ))}
                <td className="px-4 py-2 text-right tnum">
                  {formatNumber(report.overall.total)}
                </td>
              </tr>
            </tbody>

            {report.groups.map((group) => (
              <DailyActivityGroup
                key={group.orgUnitId}
                group={group}
                date={report.date}
                // A branch where nothing happened opens collapsed. On a page
                // listing every branch, the ones worth reading are the ones with
                // something in them — and the silent ones are still visible as a
                // heading with their idle count, which is the fact a manager needs.
                defaultOpen={group.subtotal.total > 0 || report.groups.length <= 3}
              />
            ))}
          </table>
        </div>
      )}

      <p className="text-xs text-[var(--color-text-subtle)]">
        Counts work recorded in the system — a lead handed over, a mobile verified, a visit
        checked into. It does not track presence, sign-in times or idle periods. Open leads is a
        backlog at the end of that day, not something done on it, so it is not part of the total.{' '}
        <Link href="/reports" className="underline underline-offset-2">
          The period report
        </Link>{' '}
        is the better place to judge a month.
      </p>
    </div>
  );
}
