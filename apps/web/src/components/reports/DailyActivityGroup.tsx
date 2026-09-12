'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useId, useState } from 'react';
import type { ActivityMetric, DailyActivityGroup as Group, DailyActivityRow } from '@sihl-one/contracts';

import { formatNumber } from '@/lib/format';
import { ACTIVITY_COLUMNS } from './activity-columns';

/**
 * One branch, as two row groups inside the report's single table.
 *
 * Deliberately not its own table. A table per branch sizes its own columns, so
 * "Verified" sits in a different place in every card and the eye has to find
 * the column again at each heading — which defeats the one thing a roll-up
 * report is for, reading down a column across branches.
 *
 * The branch line carries its totals whether it is open or shut: on a page of
 * nine branches most stay shut, and a heading that says only "42 actions" makes
 * a reader open everything to find out which forty-two.
 */

function Cell({ value, href }: { value: number; href: string | null }) {
  if (value === 0) {
    // A dash, not a nought, and not a link. A grid of zeros is unreadable, and
    // a link to an empty list is a wasted trip.
    return <span className="text-[var(--color-text-subtle)]">–</span>;
  }
  if (!href) return <span>{formatNumber(value)}</span>;
  return (
    <Link
      href={href as Route}
      className="font-medium underline decoration-dotted underline-offset-4 hover:decoration-solid"
    >
      {formatNumber(value)}
    </Link>
  );
}

export function DailyActivityGroup({
  group,
  date,
  defaultOpen,
}: {
  group: Group;
  date: string;
  /** Open when there is something to see; a silent branch starts collapsed. */
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const idle = group.rows.filter((row) => row.total === 0).length;

  const detailHref = (row: DailyActivityRow, metric: ActivityMetric) =>
    `/reports/daily/detail?userId=${row.userId}&date=${date}&metric=${metric}`;

  return (
    <>
      <tbody>
        <tr className="border-y border-[var(--color-border)] bg-[var(--color-surface-muted)] font-semibold">
          <th scope="rowgroup" className="px-4 py-2 text-left font-semibold">
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              aria-controls={bodyId}
              className="flex items-center gap-2 text-left hover:underline"
            >
              <span
                aria-hidden
                className={`inline-block text-xs text-[var(--color-text-muted)] transition-transform ${
                  open ? 'rotate-90' : ''
                }`}
              >
                ▶
              </span>
              <span>
                <span>{group.name}</span>
                <span className="block text-xs font-normal text-[var(--color-text-subtle)]">
                  {group.code} · {group.rows.length}{' '}
                  {group.rows.length === 1 ? 'person' : 'people'}
                  {idle > 0 ? ` · ${idle} with nothing recorded` : ''}
                </span>
              </span>
            </button>
          </th>
          {ACTIVITY_COLUMNS.map((column) => (
            <td key={column.key} className="px-2 py-2 text-right tnum">
              {/* Subtotals are not links: a branch's detail is the union of its
                  people's, which is a different question from "what did this
                  person do". */}
              <Cell value={group.subtotal[column.key]} href={null} />
            </td>
          ))}
          <td className="px-4 py-2 text-right tnum">
            <Cell value={group.subtotal.total} href={null} />
          </td>
        </tr>
      </tbody>

      {/* A row group of its own, so aria-controls has one element to name and
          the people disappear as a unit. */}
      <tbody id={bodyId}>
        {open
          ? group.rows.map((row) => (
              <tr
                key={row.userId}
                className={`border-b border-[var(--color-border)] ${
                  row.total === 0
                    ? 'bg-[var(--color-warn-surface)]'
                    : 'hover:bg-[var(--color-surface-inset)]'
                }`}
              >
                <td className="py-2 pl-10 pr-4">
                  <span className="font-medium">{row.fullName}</span>
                  <span className="block text-xs font-normal text-[var(--color-text-subtle)]">
                    {row.employeeCode ?? ''}
                    {row.manager
                      ? `${row.employeeCode ? ' · ' : ''}reports to ${row.manager}`
                      : ''}
                  </span>
                </td>
                {ACTIVITY_COLUMNS.map((column) => (
                  <td key={column.key} className="px-2 py-2 text-right tnum">
                    <Cell value={row[column.key]} href={detailHref(row, column.key)} />
                  </td>
                ))}
                <td className="px-4 py-2 text-right tnum font-semibold">
                  {row.total === 0 ? (
                    <span className="text-[var(--color-text-subtle)]">–</span>
                  ) : (
                    formatNumber(row.total)
                  )}
                </td>
              </tr>
            ))
          : null}
      </tbody>
    </>
  );
}
