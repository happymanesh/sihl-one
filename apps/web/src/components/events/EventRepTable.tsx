'use client';

import Link from 'next/link';
import type { Route } from 'next';
import type { EventRepBreakdown } from '@sihl-one/contracts';

import { formatNumber } from '@/lib/format';

/**
 * Who brought in what, and how much of it can actually be rung.
 *
 * Three numbers per rep rather than a stage breakdown: at an event the useful
 * question is not what stage a lead reached but whether the number is real.
 * An unverified lead is one somebody may never reach, and a rep with forty
 * captures and four verified numbers had a different day from one with forty
 * of each.
 *
 * Every count is a link. The row totals and the column meanings are the same
 * filters the leads list already understands, so a drill-down lands on exactly
 * the rows the number was counted from — no approximations.
 */
export function EventRepTable({ eventId, rows }: { eventId: string; rows: EventRepBreakdown[] }) {
  if (rows.length === 0) {
    return (
      <p className="mt-3 text-sm text-[var(--color-text-muted)]">
        Nothing captured yet, so there is nobody to credit.
      </p>
    );
  }

  const totals = rows.reduce(
    (sum, row) => ({
      verified: sum.verified + row.verified,
      unverified: sum.unverified + row.unverified,
      total: sum.total + row.total,
    }),
    { verified: 0, unverified: 0, total: 0 },
  );

  /** The leads a given cell was counted from. */
  const href = (row: EventRepBreakdown, kind: 'verified' | 'unverified' | 'all'): Route => {
    const parts = [`eventId=${eventId}`];
    // A named rep filters by id; the unattributed row filters by "nobody".
    parts.push(row.userId ? `capturedById=${row.userId}` : 'captured=none');
    if (kind === 'verified') parts.push('mobileVerified=true');
    if (kind === 'unverified') parts.push('mobileVerified=false');
    return `/leads?${parts.join('&')}` as Route;
  };

  const cell = 'px-4 py-3 text-right tnum';
  const head =
    'px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]';

  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--color-border)]">
      <table className="w-full text-sm">
        <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] text-left">
          <tr>
            <th className={head}>Rep</th>
            <th className={`${head} text-right`}>OTP verified</th>
            <th className={`${head} text-right`}>Not verified</th>
            <th className={`${head} text-right`}>Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {rows.map((row) => (
            <tr key={row.userId ?? 'unattributed'}>
              <td className="px-4 py-3">
                <span
                  className={`font-semibold ${
                    row.userId ? '' : 'italic text-[var(--color-text-muted)]'
                  }`}
                >
                  {row.fullName}
                </span>
                {row.employeeCode ? (
                  <span className="ml-1.5 font-mono text-xs text-[var(--color-text-subtle)]">
                    [{row.employeeCode}]
                  </span>
                ) : null}
              </td>

              <td className={cell}>
                {row.verified > 0 ? (
                  <Link
                    href={href(row, 'verified')}
                    className="font-semibold text-brand-green-700 hover:underline dark:text-brand-green-400"
                  >
                    {formatNumber(row.verified)}
                  </Link>
                ) : (
                  <span className="text-[var(--color-text-subtle)]">0</span>
                )}
              </td>

              <td className={cell}>
                {row.unverified > 0 ? (
                  <Link
                    href={href(row, 'unverified')}
                    className="font-semibold text-danger-600 hover:underline dark:text-danger-500"
                  >
                    {formatNumber(row.unverified)}
                  </Link>
                ) : (
                  <span className="text-[var(--color-text-subtle)]">0</span>
                )}
              </td>

              <td className={`${cell} font-bold`}>
                <Link
                  href={href(row, 'all')}
                  className="font-semibold text-teal-600 hover:underline dark:text-teal-300"
                >
                  {formatNumber(row.total)}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>

        <tfoot className="border-t border-[var(--color-border)] bg-[var(--color-surface-muted)]">
          <tr>
            <td className={head}>Total</td>
            {/* The footer drills down too, across every rep rather than one:
                the same filters minus the rep, so the number and the list it
                opens are counted from the same rows. */}
            <td className={`${cell} font-bold`}>
              <Link
                href={`/leads?eventId=${eventId}&mobileVerified=true` as Route}
                className="font-semibold text-brand-green-700 hover:underline dark:text-brand-green-400"
              >
                {formatNumber(totals.verified)}
              </Link>
            </td>
            <td className={`${cell} font-bold`}>
              <Link
                href={`/leads?eventId=${eventId}&mobileVerified=false` as Route}
                className="font-semibold text-danger-600 hover:underline dark:text-danger-500"
              >
                {formatNumber(totals.unverified)}
              </Link>
            </td>
            <td className={`${cell} font-bold`}>
              <Link
                href={`/leads?eventId=${eventId}` as Route}
                className="font-semibold text-teal-600 hover:underline dark:text-teal-300"
              >
                {formatNumber(totals.total)}
              </Link>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
