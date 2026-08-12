import Link from 'next/link';
import type { LeadListItem } from '@sihl-one/contracts';

import { ScoreBadge } from '@/components/ui/Badge';
import { apiFetch, toQuery } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { formatCompactCurrency, humanise } from '@/lib/format';

export const metadata = { title: 'Pipeline' };

const COLUMNS = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL'] as const;

interface PipelineSummary {
  columns: Array<{ status: string; count: number; estimatedValue: string }>;
  total: number;
}

interface Paginated {
  items: LeadListItem[];
  total: number;
}

/**
 * Kanban board.
 *
 * Only the four live stages are shown. Converted, Lost and Disqualified are
 * outcomes, not places work sits — including them makes the board scroll
 * sideways past the columns anyone actually works in.
 *
 * Each column is loaded independently with its own count, so a column with
 * 4,000 leads costs the same as one with four; the header shows the true total
 * while the body shows the first slice.
 */
export default async function PipelinePage() {
  await requireUser();

  const summary = await apiFetch<PipelineSummary>('/leads/pipeline');

  const columns = await Promise.all(
    COLUMNS.map(async (status) => {
      const data = await apiFetch<Paginated>(
        `/leads${toQuery({ status, pageSize: '12', sortBy: 'score', sortDir: 'desc' })}`,
      );
      const totals = summary.columns.find((column) => column.status === status);
      return {
        status,
        leads: data.items,
        total: totals?.count ?? data.total,
        value: totals?.estimatedValue ?? '0',
      };
    }),
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Pipeline</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Open leads by stage, highest score first
          </p>
        </div>
        <Link href="/leads" className="btn btn-outline">
          List view
        </Link>
      </header>

      <div className="grid gap-3 lg:grid-cols-4">
        {columns.map((column) => (
          <section
            key={column.status}
            className="flex min-w-0 flex-col rounded-card border border-[var(--color-border)] bg-[var(--color-surface-muted)]"
            aria-label={`${humanise(column.status)} column`}
          >
            <header className="border-b border-[var(--color-border)] px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-bold">{humanise(column.status)}</h2>
                <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-xs font-bold tnum">
                  {column.total}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-[var(--color-text-subtle)] tnum">
                {formatCompactCurrency(column.value)}
              </p>
            </header>

            <div className="flex-1 space-y-2 p-2">
              {column.leads.length === 0 ? (
                <p className="px-1 py-6 text-center text-xs text-[var(--color-text-subtle)]">
                  Nothing at this stage
                </p>
              ) : (
                column.leads.map((lead) => (
                  <Link
                    key={lead.id}
                    href={`/leads/${lead.id}`}
                    className="block rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 transition-shadow hover:shadow-raised"
                  >
                    <p className="truncate text-sm font-semibold">{lead.fullName}</p>
                    <p className="mt-0.5 truncate font-mono text-[0.6875rem] text-[var(--color-text-subtle)]">
                      {lead.reference}
                    </p>

                    <div className="mt-2 flex items-center justify-between gap-2">
                      <ScoreBadge score={lead.score} band={lead.scoreBand} />
                      <span className="shrink-0 text-xs font-bold tnum">
                        {formatCompactCurrency(lead.estimatedValue)}
                      </span>
                    </div>

                    {lead.isOverdue ? (
                      <p className="mt-2 text-[0.6875rem] font-bold text-danger-500">
                        Follow-up overdue
                      </p>
                    ) : lead.owner ? (
                      <p className="mt-2 truncate text-[0.6875rem] text-[var(--color-text-subtle)]">
                        {lead.owner.fullName}
                      </p>
                    ) : (
                      <p className="mt-2 text-[0.6875rem] font-bold text-warn-600">Unassigned</p>
                    )}
                  </Link>
                ))
              )}

              {column.total > column.leads.length ? (
                <Link
                  href={`/leads?status=${column.status}`}
                  className="block rounded-lg px-3 py-2 text-center text-xs font-semibold text-[var(--color-text-muted)] hover:bg-[var(--color-surface)]"
                >
                  View all {column.total} →
                </Link>
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
