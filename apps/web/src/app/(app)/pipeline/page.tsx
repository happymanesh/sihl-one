import Link from 'next/link';
import {
  CLOSED_PERIOD_LABELS,
  CLOSED_PERIODS,
  isClosedPeriod,
  scoreBandFor,
  type ProductItem,
} from '@sihl-one/contracts';

import { ScoreBadge } from '@/components/ui/Badge';

import { PipelineFilters } from '@/components/leads/PipelineFilters';
import { apiFetch, toQuery } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { formatCurrency, formatDate, humanise } from '@/lib/format';


export const metadata = { title: 'Pipeline' };

const COLUMNS = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL'] as const;

/** A card on the board: one product on one lead, at that product's own stage. */
interface BoardCard {
  id: string;
  leadId: string;
  reference: string;
  name: string;
  productCode: string;
  productName: string;
  score: number;
  priority: string;
  nextFollowUpAt: string | null;
  ownerName: string | null;
}

interface BoardColumn {
  items: BoardCard[];
  total: number;
}

interface ClosedCard extends BoardCard {
  status: string;
  finalAmount: string | null;
  lostReason: string | null;
  closedAt: string | null;
}

interface ClosedColumn {
  items: ClosedCard[];
  total: number;
  byOutcome: Record<string, number>;
}

/**
 * Kanban board, one card per product.
 *
 * A client interested in equity, F&O and mutual funds appears three times, each
 * card in whichever column that product has reached. Counting leads instead put
 * them in a single column chosen by their furthest product, hiding the other two
 * conversations — which is what the national sales head asked to change.
 *
 * Only the four live stages are shown. Converted, Lost and Disqualified are
 * outcomes, not places work sits — including them makes the board scroll
 * sideways past the columns anyone actually works in.
 *
 * Each column is loaded independently with its own count, so a column with
 * 4,000 leads costs the same as one with four; the header shows the true total
 * while the body shows the first slice.
 */
export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const params = await searchParams;
  const productInterest = params.productInterest as string | string[] | undefined;
  const period = isClosedPeriod(params.period) ? params.period : '1M';

  const products = await apiFetch<ProductItem[]>('/masters/products').catch(
    () => [] as ProductItem[],
  );

  const columns = await Promise.all(
    COLUMNS.map(async (status) => {
      // Each column carries its own total, so there is no separate summary call
      // and the number can never disagree with the filter in force.
      const data = await apiFetch<BoardColumn>(
        `/leads/pipeline/products/column${toQuery({ status, productInterest, pageSize: '12' })}`,
      );
      return { status, cards: data.items, total: data.total };
    }),
  );

  // Closed is fetched separately because it is a different question: not "where
  // is this work" but "what finished, and how did it go".
  const closed = await apiFetch<ClosedColumn>(
    `/leads/pipeline/closed${toQuery({ period, productInterest, pageSize: '12' })}`,
  ).catch(() => ({ items: [], total: 0, byOutcome: {} }) as ClosedColumn);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Pipeline</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            One card per product — a lead wanting three products appears three times
          </p>
        </div>
        <Link href="/leads" className="btn btn-outline">
          List view
        </Link>
      </header>

      <PipelineFilters products={products} />

      <div className="grid gap-3 lg:grid-cols-5">
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

            </header>

            <div className="flex-1 space-y-2 p-2">
              {column.cards.length === 0 ? (
                <p className="px-1 py-6 text-center text-xs text-[var(--color-text-subtle)]">
                  Nothing at this stage
                </p>
              ) : (
                column.cards.map((card) => {
                  const overdue = Boolean(
                    card.nextFollowUpAt && new Date(card.nextFollowUpAt) < new Date(),
                  );
                  return (
                    <Link
                      key={card.id}
                      href={`/leads/${card.leadId}`}
                      className="block rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 transition-shadow hover:shadow-raised"
                    >
                      {/* The product leads the card. Two cards for the same
                          client differ only by this, so burying it under the
                          name would make them look like duplicates. */}
                      <p className="truncate text-xs font-bold text-teal-700 dark:text-teal-300">
                        {card.productName}
                      </p>
                      <p className="mt-0.5 truncate text-sm font-semibold">{card.name}</p>
                      <p className="mt-0.5 truncate font-mono text-[0.6875rem] text-[var(--color-text-subtle)]">
                        {card.reference}
                      </p>

                      <div className="mt-2">
                        <ScoreBadge score={card.score} band={scoreBandFor(card.score)} />
                      </div>

                      {overdue ? (
                        <p className="mt-2 text-[0.6875rem] font-bold text-danger-500">
                          Follow-up overdue
                        </p>
                      ) : card.ownerName ? (
                        <p className="mt-2 truncate text-[0.6875rem] text-[var(--color-text-subtle)]">
                          {card.ownerName}
                        </p>
                      ) : (
                        <p className="mt-2 text-[0.6875rem] font-bold text-warn-600">Unassigned</p>
                      )}
                    </Link>
                  );
                })
              )}

              {column.total > column.cards.length ? (
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

        {/* Closed sits at the end, and reads differently from the four before
            it: an outcome per card rather than a stage, and a window, because
            closed work never stops accumulating. */}
        <section
          className="flex min-w-0 flex-col rounded-card border border-[var(--color-border)] bg-[var(--color-surface-muted)]"
          aria-label="Closed column"
        >
          <header className="border-b border-[var(--color-border)] px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-bold">Closed</h2>
              <span className="rounded-full bg-[var(--color-surface)] px-2 py-0.5 text-xs font-bold tnum">
                {closed.total}
              </span>
            </div>

            {/* A plain GET form, so the choice survives a bookmark and needs no
                JavaScript to work. */}
            <form method="GET" className="mt-1.5">
              {/* Carried through, or changing the window would silently clear
                  the product filter the rest of the board is showing. */}
              {(Array.isArray(productInterest) ? productInterest : productInterest ? [productInterest] : []).map(
                (code) => (
                  <input key={code} type="hidden" name="productInterest" value={code} />
                ),
              )}
              <select
                name="period"
                defaultValue={period}
                aria-label="How far back to show closed work"
                className="w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1 text-xs font-semibold"
              >
                {CLOSED_PERIODS.map((value) => (
                  <option key={value} value={value}>
                    {CLOSED_PERIOD_LABELS[value]}
                  </option>
                ))}
              </select>
              <noscript>
                <button type="submit" className="mt-1 w-full rounded-lg border px-2 py-1 text-xs">
                  Apply
                </button>
              </noscript>
            </form>

            {closed.total > 0 ? (
              <p className="mt-1.5 text-[0.6875rem] text-[var(--color-text-subtle)] tnum">
                {closed.byOutcome.CONVERTED ?? 0} won · {closed.byOutcome.LOST ?? 0} lost ·{' '}
                {closed.byOutcome.DISQUALIFIED ?? 0} disqualified
              </p>
            ) : null}
          </header>

          <div className="flex-1 space-y-2 p-2">
            {closed.items.length === 0 ? (
              <p className="px-1 py-6 text-center text-xs text-[var(--color-text-subtle)]">
                Nothing closed in this period
              </p>
            ) : (
              closed.items.map((card) => (
                <Link
                  key={card.id}
                  href={`/leads/${card.leadId}`}
                  className="block rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 transition-shadow hover:shadow-raised"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate text-xs font-bold text-[var(--color-text-muted)]">
                      {card.productName}
                    </p>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[0.625rem] font-bold uppercase ${
                        card.status === 'CONVERTED'
                          ? 'bg-teal-500 text-white'
                          : card.status === 'LOST'
                            ? 'bg-danger-50 text-danger-600 dark:bg-danger-500/20'
                            : 'bg-[var(--color-surface-muted)] text-[var(--color-text-subtle)]'
                      }`}
                    >
                      {card.status === 'DISQUALIFIED' ? 'Disq.' : humanise(card.status)}
                    </span>
                  </div>

                  <p className="mt-0.5 truncate text-sm font-semibold">{card.name}</p>

                  {card.finalAmount ? (
                    <p className="mt-1 text-xs font-bold tnum">
                      {formatCurrency(card.finalAmount)}
                    </p>
                  ) : null}
                  {card.lostReason ? (
                    <p className="mt-1 truncate text-[0.6875rem] text-[var(--color-text-muted)]">
                      {humanise(card.lostReason)}
                    </p>
                  ) : null}

                  {card.closedAt ? (
                    <p className="mt-1.5 text-[0.6875rem] text-[var(--color-text-subtle)]">
                      {formatDate(card.closedAt)}
                    </p>
                  ) : null}
                </Link>
              ))
            )}

            {closed.total > closed.items.length ? (
              <p className="px-3 py-2 text-center text-xs text-[var(--color-text-subtle)]">
                {closed.total - closed.items.length} more in this period
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
