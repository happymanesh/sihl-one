'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useState } from 'react';
import type { EventRepBreakdown } from '@sihl-one/contracts';

import { formatNumber, humanise } from '@/lib/format';

/**
 * Who brought in what, with the stage split underneath.
 *
 * Collapsed to one row per rep, expanding to the stages, because the first
 * question is "who worked the stall" and the second is "and what came of it" —
 * putting both on one line makes a table nobody can scan. Same shape as the
 * daily activity report on purpose: the people reading this already know how
 * that one behaves, and a second convention to learn is a cost with no return.
 */
export function EventRepTable({
  eventId,
  rows,
}: {
  eventId: string;
  rows: EventRepBreakdown[];
}) {
  const [open, setOpen] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <p className="mt-3 text-sm text-[var(--color-text-muted)]">
        Nothing captured yet, so there is nobody to credit.
      </p>
    );
  }

  const total = rows.reduce((sum, row) => sum + row.total, 0);

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-[var(--color-border)]">
      <table className="w-full text-sm">
        <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] text-left">
          <tr>
            {['Rep', 'Leads', ''].map((heading) => (
              <th
                key={heading}
                className="px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]"
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {rows.map((row) => {
            const key = row.userId ?? 'unattributed';
            const expanded = open === key;
            // Computed query strings: typedRoutes cannot check these, so they
            // are built once here rather than cast inline in three places.
            const repFilter = row.userId ? `&capturedById=${row.userId}` : '';
            const allHref = `/leads?eventId=${eventId}${repFilter}` as Route;
            return (
              <tr key={key} className="align-top">
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : key)}
                    aria-expanded={expanded}
                    className="text-left"
                  >
                    <span
                      className={`font-semibold ${
                        row.userId ? '' : 'text-[var(--color-text-muted)] italic'
                      }`}
                    >
                      {row.fullName}
                    </span>
                    {row.employeeCode ? (
                      <span className="ml-1.5 font-mono text-xs text-[var(--color-text-subtle)]">
                        [{row.employeeCode}]
                      </span>
                    ) : null}
                    <span className="ml-2 text-xs text-teal-600 dark:text-teal-300">
                      {expanded ? 'Hide stages' : 'Show stages'}
                    </span>
                  </button>

                  {expanded ? (
                    <ul className="mt-2 space-y-1 border-l-2 border-[var(--color-border)] pl-3">
                      {row.byStatus
                        .slice()
                        .sort((a, b) => b.count - a.count)
                        .map((stage) => (
                          <li key={stage.status} className="flex justify-between gap-4 text-xs">
                            <Link
                              href={
                                `/leads?eventId=${eventId}&status=${stage.status}${repFilter}` as Route
                              }
                              className="hover:underline"
                            >
                              {humanise(stage.status)}
                            </Link>
                            <span className="tnum">{formatNumber(stage.count)}</span>
                          </li>
                        ))}
                    </ul>
                  ) : null}
                </td>

                <td className="px-4 py-3 font-bold tnum">{formatNumber(row.total)}</td>

                <td className="px-4 py-3 text-right">
                  <Link
                    href={allHref}
                    className="text-xs font-semibold text-teal-600 hover:underline dark:text-teal-300"
                  >
                    View
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t border-[var(--color-border)] bg-[var(--color-surface-muted)]">
          <tr>
            <td className="px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
              Total
            </td>
            <td className="px-4 py-2.5 font-bold tnum">{formatNumber(total)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
