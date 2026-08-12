import Link from 'next/link';
import type { LeadListItem } from '@sihl-one/contracts';

import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/shell/Icon';
import { LeadFilters } from '@/components/leads/LeadFilters';
import { LeadTable } from '@/components/leads/LeadTable';
import { Pagination } from '@/components/ui/Pagination';
import type { LeadSourceItem } from '@sihl-one/contracts';
import { apiFetch, toQuery } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';
import { formatNumber } from '@/lib/format';

export const metadata = { title: 'Leads' };

interface Paginated {
  items: LeadListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * Filters live in the URL, not in component state.
 *
 * That makes a filtered view shareable ("look at these overdue Surat leads"),
 * bookmarkable, and survivable across a refresh — and it lets the dashboard
 * tiles deep-link straight into the right slice.
 */
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const first = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const query = toQuery({
    q: first('q'),
    status: params.status as string | string[] | undefined,
    source: params.source as string | string[] | undefined,
    priority: first('priority'),
    ownerId: first('ownerId'),
    overdueOnly: first('overdueOnly'),
    minScore: first('minScore'),
    sortBy: first('sortBy') ?? 'createdAt',
    sortDir: first('sortDir') ?? 'desc',
    page: first('page') ?? '1',
    pageSize: '20',
  });

  const sources = await apiFetch<LeadSourceItem[]>('/masters/lead-sources').catch(
    () => [] as LeadSourceItem[],
  );

  const data = await apiFetch<Paginated>(`/leads${query}`);
  const hasFilters = Boolean(
    first('q') || params.status || params.source || first('priority') || first('overdueOnly') || first('minScore'),
  );

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Leads</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {formatNumber(data.total)} {data.total === 1 ? 'lead' : 'leads'} in your scope
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/pipeline" className="btn btn-outline">
            <Icon name="columns" size={16} />
            Pipeline view
          </Link>
          {can(user, 'lead:import') ? (
            <Link href="/leads/import" className="btn btn-outline">
              Import
            </Link>
          ) : null}
          {can(user, 'lead:create') ? (
            <Link href="/leads/new" className="btn btn-primary">
              <Icon name="plus" size={16} />
              New lead
            </Link>
          ) : null}
        </div>
      </header>

      <LeadFilters sources={sources} />

      {data.items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Icon name="target" size={40} />}
            title={hasFilters ? 'No leads match these filters' : 'No leads yet'}
            description={
              hasFilters
                ? 'Try widening the filters, or clear them to see everything in your scope.'
                : 'Leads arrive from the website, campaigns and partners — or you can add one yourself.'
            }
            action={
              hasFilters ? (
                <Link href="/leads" className="btn btn-outline">
                  Clear filters
                </Link>
              ) : can(user, 'lead:create') ? (
                <Link href="/leads/new" className="btn btn-primary">
                  Add the first lead
                </Link>
              ) : null
            }
          />
        </div>
      ) : (
        <>
          <LeadTable leads={data.items} />
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
