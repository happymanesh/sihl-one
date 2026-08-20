import Link from 'next/link';
import type { LeadListItem } from '@sihl-one/contracts';

import { LeadStatusBadge, PriorityBadge, ScoreBadge } from '@/components/ui/Badge';
import { ProductChips } from '@/components/ui/ProductChips';
import { formatCompactCurrency, formatDate, formatRelative, humanise } from '@/lib/format';

/**
 * Two layouts, one dataset.
 *
 * A table is right on a desktop and unusable on a 375px phone, where it becomes
 * a horizontal-scroll trap. Field sales live on phones, so below `md` the same
 * rows render as cards. Doing this with CSS overflow instead would technically
 * "work" and would be miserable to actually use on a visit.
 */
export function LeadTable({
  leads,
  productLabels,
}: {
  leads: LeadListItem[];
  /** Code → name from the product master, so chips read "NRI" not "Nri". */
  productLabels?: Record<string, string>;
}) {
  return (
    <>
      {/* Desktop */}
      <div className="card hidden overflow-hidden p-0 md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] text-left">
              <tr>
                <Th>Lead</Th>
                <Th>Status</Th>
                <Th>Score</Th>
                <Th>Products</Th>
                <Th>Source</Th>
                <Th>Owner</Th>
                <Th className="text-right">Value</Th>
                <Th>Follow-up</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {leads.map((lead) => (
                <tr
                  key={lead.id}
                  className="transition-colors hover:bg-[var(--color-surface-muted)]"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/leads/${lead.id}`}
                      className="font-semibold hover:text-teal-600 hover:underline dark:hover:text-teal-300"
                    >
                      {lead.fullName}
                    </Link>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--color-text-subtle)]">
                      <span className="font-mono">{lead.reference}</span>
                      <span aria-hidden>·</span>
                      {/* Masked, because a list view is the easiest place for a
                          bulk PII leak — a screenshot of 20 phone numbers. */}
                      <span className="tnum">{lead.mobileMasked}</span>
                      {lead.city ? (
                        <>
                          <span aria-hidden>·</span>
                          <span>{lead.city}</span>
                        </>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <LeadStatusBadge status={lead.status} />
                      {lead.priority === 'HIGH' || lead.priority === 'URGENT' ? (
                        <PriorityBadge priority={lead.priority} />
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <ScoreBadge score={lead.score} band={lead.scoreBand} />
                  </td>
                  <td className="px-4 py-3">
                    <ProductChips codes={lead.productInterest ?? []} labels={productLabels} tone="outline" />
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                    {humanise(lead.source)}
                    {lead.partner ? (
                      <div className="mt-0.5 truncate text-[var(--color-text-subtle)]">
                        {lead.partner.name}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {lead.owner ? (
                      lead.owner.fullName
                    ) : (
                      <span className="font-semibold text-warn-600">Unassigned</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tnum">
                    {formatCompactCurrency(lead.estimatedValue)}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {lead.nextFollowUpAt ? (
                      <span className={lead.isOverdue ? 'font-bold text-danger-500' : ''}>
                        {formatDate(lead.nextFollowUpAt)}
                        {lead.isOverdue ? ' · overdue' : ''}
                      </span>
                    ) : (
                      <span className="text-[var(--color-text-subtle)]">Not scheduled</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile */}
      <ul className="space-y-2.5 md:hidden">
        {leads.map((lead) => (
          <li key={lead.id}>
            <Link href={`/leads/${lead.id}`} className="card block p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-bold">{lead.fullName}</p>
                  <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">
                    {lead.reference} · {lead.mobileMasked}
                  </p>
                </div>
                <LeadStatusBadge status={lead.status} />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                <ScoreBadge score={lead.score} band={lead.scoreBand} />
                <span className="font-semibold tnum">
                  {formatCompactCurrency(lead.estimatedValue)}
                </span>
                <span className="text-[var(--color-text-muted)]">{humanise(lead.source)}</span>
              </div>

              {lead.nextFollowUpAt ? (
                <p
                  className={`mt-2 text-xs ${
                    lead.isOverdue ? 'font-bold text-danger-500' : 'text-[var(--color-text-muted)]'
                  }`}
                >
                  Follow up {formatRelative(lead.nextFollowUpAt)}
                </p>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </>
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
