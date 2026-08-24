import Link from 'next/link';
import { scoreBandFor, type ProductItem } from '@sihl-one/contracts';

import { ScoreBadge } from '@/components/ui/Badge';

import { PipelineFilters } from '@/components/leads/PipelineFilters';
import { apiFetch, toQuery } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { humanise } from '@/lib/format';


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
      </div>
    </div>
  );
}
