'use client';

import { useState } from 'react';
import {
  MIS_LEAD_GROUP_LABELS,
  type MisCounts,
  type MisTeamReport,
  type MisTeamRow,
} from '@sihl-one/contracts';

import { formatDateCompact } from '@/lib/format';

/**
 * The firm as a tree, one row per person.
 *
 * Expanded in the browser rather than fetched on open: the whole structure is
 * a few hundred people and arrives in one response, so a request per expand
 * would make the reader wait for a row they open every morning.
 *
 * Vertical heads start open. Anything below starts closed — the point of the
 * screen is which vertical needs attention, and a tree that opens fully makes
 * that harder to see rather than easier.
 */
export function TeamTree({ report }: { report: MisTeamReport }) {
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(report.rows.map((row) => row.userId)),
  );

  const toggle = (userId: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });

  /*
    Flattened to a list, so the table is one <tbody> rather than nested ones.

    A manager's own leads are emitted as a child row, but only when they have
    reports to be distinguished from: a leaf's counts already *are* their own
    book, and repeating them would say the same number twice.
  */
  const rows: Array<{ key: string; kind: 'person' | 'own'; row: MisTeamRow }> = [];
  const walk = (list: MisTeamRow[], parentOpen: boolean) => {
    for (const row of list) {
      if (parentOpen) rows.push({ key: row.userId, kind: 'person', row });
      const childrenVisible = parentOpen && open.has(row.userId);
      if (childrenVisible && row.ownBook && row.children.length > 0) {
        rows.push({ key: `${row.userId}:own`, kind: 'own', row });
      }
      walk(row.children, childrenVisible);
    }
  };
  walk(report.rows, true);

  return (
    <div className="card overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] text-left">
            <tr>
              <Th>Vertical / Person</Th>
              <Th className="text-right">Team</Th>
              <Th className="text-right">Idle</Th>
              <Th className="text-right">{MIS_LEAD_GROUP_LABELS.untouched}</Th>
              <Th className="text-right">{MIS_LEAD_GROUP_LABELS.inProgress}</Th>
              <Th className="text-right">{MIS_LEAD_GROUP_LABELS.converted}</Th>
              <Th className="text-right">{MIS_LEAD_GROUP_LABELS.lost}</Th>
              <Th className="text-right">Total leads</Th>
              <Th>Last activity</Th>
              <Th className="text-right">Idle days</Th>
            </tr>
          </thead>

          <tbody className="divide-y divide-[var(--color-border)]">
            {rows.map(({ key, kind, row }) =>
              kind === 'own' ? (
                <OwnBookRow key={key} row={row} />
              ) : (
                <Row
                  key={key}
                  row={row}
                  expanded={open.has(row.userId)}
                  onToggle={() => toggle(row.userId)}
                  idleAfterDays={report.idleAfterDays}
                />
              ),
            )}

            {report.exceptions.chiefOwnBook ? (
              <ExceptionRow
                label={`${report.chief?.name ?? 'Chief executive'} — own book`}
                hint="Should be nobody's. A lead here is one no vertical is working."
                counts={report.exceptions.chiefOwnBook}
              />
            ) : null}

            {report.exceptions.unassigned.total > 0 ? (
              <ExceptionRow
                label="Unassigned"
                hint="No owner at all — invisible on every other screen."
                counts={report.exceptions.unassigned}
              />
            ) : null}

            {report.exceptions.outsideStructure.total > 0 ? (
              <ExceptionRow
                label="Owned outside the structure"
                hint="The owner's reporting line never reaches the chief executive."
                counts={report.exceptions.outsideStructure}
              />
            ) : null}
          </tbody>

          <tfoot className="border-t-2 border-[var(--color-border)] bg-[var(--color-surface-muted)] font-bold">
            <tr>
              <td className="px-4 py-3">Total</td>
              <Num value={report.totalPeople} />
              <Num value={report.totalIdle} />
              <Num value={report.totals.untouched} />
              <Num value={report.totals.inProgress} />
              <Num value={report.totals.converted} />
              <Num value={report.totals.lost} />
              <Num value={report.totals.total} />
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>

      {/*
        The reconciliation, said rather than left to be discovered.

        An expanded tree double-counts by design — a parent contains its
        children — so anybody adding a column down the page gets a number
        larger than the book. This is the line that explains it, and the
        mismatch warning is the one that matters: it means a lead is owned by
        somebody the hierarchy does not reach.
      */}
      <p className="border-t border-[var(--color-border)] px-4 py-3 text-xs text-[var(--color-text-muted)]">
        <strong className="text-[var(--color-text)]">
          {report.totals.total.toLocaleString('en-IN')}
        </strong>{' '}
        leads across every row above, against{' '}
        <strong className="text-[var(--color-text)]">
          {report.uniqueLeads.toLocaleString('en-IN')}
        </strong>{' '}
        in the book.{' '}
        {report.totals.total === report.uniqueLeads ? (
          'Every lead is counted once.'
        ) : (
          <span className="font-semibold text-danger-600">
            These should match —{' '}
            {Math.abs(report.uniqueLeads - report.totals.total).toLocaleString('en-IN')} unaccounted
            for.
          </span>
        )}{' '}
        Expanding a row shows its people, whose numbers are already included in it. Idle means no
        activity for {report.idleAfterDays} days or more.
      </p>
    </div>
  );
}

function Row({
  row,
  expanded,
  onToggle,
  idleAfterDays,
}: {
  row: MisTeamRow;
  expanded: boolean;
  onToggle: () => void;
  idleAfterDays: number;
}) {
  const hasChildren = row.children.length > 0;
  const isHead = row.level === 0;
  // A person who has never done anything reads differently from one who has
  // gone quiet, so the column says so rather than showing a dash for both.
  const late = row.idleDays === null || row.idleDays >= idleAfterDays;

  return (
    <tr className="hover:bg-[var(--color-surface-muted)]">
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1.5" style={{ paddingLeft: `${row.level * 18}px` }}>
          {hasChildren ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--color-text-muted)] hover:bg-[var(--color-surface-inset)]"
            >
              <span aria-hidden>{expanded ? '▾' : '▸'}</span>
              <span className="sr-only">
                {expanded ? 'Collapse' : 'Expand'} {row.name}
              </span>
            </button>
          ) : (
            <span className="h-5 w-5 shrink-0" aria-hidden />
          )}

          <span className="min-w-0">
            <span className={`block truncate ${isHead ? 'font-bold' : 'font-medium'}`}>
              {row.name}
            </span>
            <span className="block truncate text-xs text-[var(--color-text-subtle)]">
              {[row.employeeCode, row.designation].filter(Boolean).join(' · ') || '—'}
            </span>
          </span>
        </div>
      </td>

      <Num value={row.teamSize} />
      <Num value={row.idleCount} tone={row.idleCount > 0 ? 'warn' : undefined} />
      <Num value={row.counts.untouched} />
      <Num value={row.counts.inProgress} />
      <Num value={row.counts.converted} />
      <Num value={row.counts.lost} />
      <Num value={row.counts.total} strong />
      <td className="px-4 py-2.5 text-xs text-[var(--color-text-muted)]">
        {row.lastActivityOn ? formatDateCompact(row.lastActivityOn) : 'Never'}
      </td>
      <td
        className={`px-4 py-2.5 text-right tnum ${
          late ? 'font-semibold text-danger-600' : 'text-[var(--color-text-muted)]'
        }`}
      >
        {row.idleDays === null ? '—' : row.idleDays}
      </td>
    </tr>
  );
}

/**
 * A manager's own leads, shown as a child so the children of a row add up to
 * it exactly. Without it nobody could reconcile an expanded branch.
 */
function OwnBookRow({ row }: { row: MisTeamRow }) {
  if (!row.ownBook) return null;
  return (
    <tr className="bg-[var(--color-surface-muted)]/40 text-[var(--color-text-muted)]">
      <td className="px-4 py-2" style={{ paddingLeft: `${(row.level + 1) * 18 + 16}px` }}>
        <span className="text-xs italic">{row.name} — own book</span>
      </td>
      <td />
      <td />
      <Num value={row.ownBook.untouched} />
      <Num value={row.ownBook.inProgress} />
      <Num value={row.ownBook.converted} />
      <Num value={row.ownBook.lost} />
      <Num value={row.ownBook.total} />
      <td colSpan={2} />
    </tr>
  );
}

function ExceptionRow({ label, hint, counts }: { label: string; hint: string; counts: MisCounts }) {
  return (
    <tr className="bg-warn-50/60 dark:bg-warn-500/10">
      <td className="px-4 py-2.5">
        <span className="block font-semibold text-warn-600 dark:text-warn-100">{label}</span>
        <span className="block text-xs text-[var(--color-text-muted)]">{hint}</span>
      </td>
      <td />
      <td />
      <Num value={counts.untouched} />
      <Num value={counts.inProgress} />
      <Num value={counts.converted} />
      <Num value={counts.lost} />
      <Num value={counts.total} strong />
      <td colSpan={2} />
    </tr>
  );
}

function Num({ value, strong, tone }: { value: number; strong?: boolean; tone?: 'warn' }) {
  return (
    <td
      className={`px-4 py-2.5 text-right tnum ${strong ? 'font-semibold' : ''} ${
        tone === 'warn' && value > 0 ? 'text-warn-600 dark:text-warn-100' : ''
      }`}
    >
      {value === 0 ? (
        <span className="text-[var(--color-text-subtle)]">—</span>
      ) : (
        value.toLocaleString('en-IN')
      )}
    </td>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={`px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] ${className}`}
    >
      {children}
    </th>
  );
}

export { OwnBookRow };
