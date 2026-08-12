import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/shell/Icon';
import { Pagination } from '@/components/ui/Pagination';
import { PartnerFilters } from '@/components/partners/PartnerFilters';
import { apiFetch, toQuery } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';
import { formatDate, formatNumber, humanise } from '@/lib/format';

export const metadata = { title: 'Partners' };

interface PartnerRow {
  id: string;
  reference: string;
  name: string;
  type: string;
  status: string;
  contactPerson: string | null;
  city: string | null;
  branch: string | null;
  commissionRate: string | null;
  leadsSourced: number;
  clients: number;
  onboardedAt: string | null;
}

const STATUS_TONES: Record<string, 'green' | 'amber' | 'red' | 'neutral'> = {
  ACTIVE: 'green',
  PENDING: 'amber',
  SUSPENDED: 'red',
  TERMINATED: 'neutral',
};

export default async function PartnersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  // Guarded here as well as in the nav: a permission check that only exists
  // in the menu is one somebody can navigate around, and a raw 403 renders as
  // the generic error card rather than as "you do not have access".
  if (!can(user, 'partner:read')) redirect('/dashboard');

  const params = await searchParams;

  const data = await apiFetch<{
    items: PartnerRow[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  }>(
    `/partners${toQuery({
      q: params.q,
      status: params.status,
      type: params.type,
      page: params.page ?? '1',
      pageSize: '20',
    })}`,
  );

  const isFiltered = Boolean(params.q || params.status || params.type);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Partners</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {formatNumber(data.total)} associate {data.total === 1 ? 'partner' : 'partners'} in your
          scope
        </p>
      </header>

      <PartnerFilters />

      {data.items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Icon name="handshake" size={40} />}
            title={isFiltered ? 'No partners match those filters' : 'No partners yet'}
            description={
              isFiltered
                ? 'Try widening the search, or clear the filters to see everyone.'
                : 'Associate partners appear here once operations onboards them.'
            }
            action={
              isFiltered ? (
                <Link href="/partners" className="btn btn-outline">
                  Clear filters
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <div className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] text-left">
                  <tr>
                    {['Partner', 'Type', 'Status', 'Sourced', 'Clients', 'Rate', 'Since'].map(
                      (heading) => (
                        <th
                          key={heading}
                          scope="col"
                          className="px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]"
                        >
                          {heading}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {data.items.map((partner) => (
                    <tr key={partner.id} className="hover:bg-[var(--color-surface-muted)]">
                      <td className="px-4 py-3">
                        <Link
                          href={`/partners/${partner.id}`}
                          className="font-semibold hover:text-teal-600 hover:underline dark:hover:text-teal-300"
                        >
                          {partner.name}
                        </Link>
                        <div className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
                          <span className="font-mono">{partner.reference}</span>
                          {partner.contactPerson ? (
                            <>
                              <span className="mx-1.5" aria-hidden>
                                ·
                              </span>
                              {partner.contactPerson}
                            </>
                          ) : null}
                          {partner.city ? (
                            <>
                              <span className="mx-1.5" aria-hidden>
                                ·
                              </span>
                              {partner.city}
                            </>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">{humanise(partner.type)}</td>
                      <td className="px-4 py-3">
                        <Badge tone={STATUS_TONES[partner.status] ?? 'neutral'}>
                          {humanise(partner.status)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 tnum">{formatNumber(partner.leadsSourced)}</td>
                      <td className="px-4 py-3 tnum">{formatNumber(partner.clients)}</td>
                      <td className="px-4 py-3 tnum text-xs">
                        {/* The agreed rate, not an amount. What a partner is
                            actually owed is the back office's answer. */}
                        {partner.commissionRate ? `${partner.commissionRate}%` : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                        {partner.onboardedAt ? formatDate(partner.onboardedAt) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            pageSize={data.pageSize}
          />
        </>
      )}
    </div>
  );
}
