import Link from 'next/link';
import type { LeadListItem } from '@sihl-one/contracts';

import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/shell/Icon';
import { LeadFilters } from '@/components/leads/LeadFilters';
import { LeadTable } from '@/components/leads/LeadTable';
import { Pagination } from '@/components/ui/Pagination';
import type { LeadSourceItem, ProductItem } from '@sihl-one/contracts';
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
    productInterest: params.productInterest as string | string[] | undefined,
    priority: first('priority'),
    ownerId: first('ownerId'),
    eventId: first('eventId'),
    attendedEventId: first('attendedEventId'),
    overdueOnly: first('overdueOnly'),
    minScore: first('minScore'),
    sortBy: first('sortBy') ?? 'createdAt',
    sortDir: first('sortDir') ?? 'desc',
    page: first('page') ?? '1',
    pageSize: '20',
  });

  const [sources, products, owners] = await Promise.all([
    apiFetch<LeadSourceItem[]>('/masters/lead-sources').catch(() => [] as LeadSourceItem[]),
    apiFetch<ProductItem[]>('/masters/products').catch(() => [] as ProductItem[]),
    /*
      Whose leads, for the owner filter.

      Guarded on `user:read`, which a sales executive does not hold — and should
      not, since their scope is their own book and the filter would be a list of
      one. The catch is the whole handling: no permission, no owners, no
      control, rather than a failed page.
    */
    can(user, 'user:read')
      ? apiFetch<Array<{ id: string; fullName: string; employeeCode?: string | null }>>(
          '/users/assignable',
        ).catch(() => [])
      : Promise.resolve([]),
  ]);

  const data = await apiFetch<Paginated>(`/leads${query}`);

  // Named, not just applied. Arriving from an event's "View the leads" with a
  // silent filter looks identical to a broken list — the reader has no way to
  // tell "this event produced three leads" from "the search is wrong".
  // Either filter names the same event; which one only changes the wording.
  const eventId = first('eventId') ?? first('attendedEventId');
  const byAttendance = Boolean(first('attendedEventId'));
  const filteredEvent = eventId
    ? await apiFetch<{ id: string; name: string }>(`/events/${eventId}`).catch(() => null)
    : null;
  // Chips show the master's name rather than a title-cased code, so NRI does
  // not render as "Nri" and MUTUAL_FUNDS reads however the business named it.
  const productLabels = Object.fromEntries(products.map((p) => [p.code, p.name]));
  const hasFilters = Boolean(
    first('q') || params.status || params.source || params.productInterest || first('priority') || first('overdueOnly') || first('minScore') || first('ownerId'),
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
        {/*
          Wraps, because a third button here is what tips this row past a phone.
          Without it the row stays one line, the page itself grows wider than
          the screen, and every screen in the app scrolls sideways — the header
          is above the fold on the list a rep opens most.
        */}
        <div className="flex flex-wrap gap-2">
          <Link href="/pipeline" className="btn btn-outline">
            <Icon name="columns" size={16} />
            Pipeline view
          </Link>
          {can(user, 'lead:import') ? (
            <Link href="/leads/import" className="btn btn-outline">
              Import
            </Link>
          ) : null}
          {/*
            Insta Lead sits beside New lead, not instead of it. They are two
            different situations: one is somebody at a desk entering a lead
            properly, the other is a rep with a client in front of them. Placing
            them together is what makes the distinction obvious.

            Needs `visit:create` as well, because it starts a meeting — anyone
            who may only create leads still gets the ordinary form.
          */}
          {can(user, 'lead:create') && can(user, 'visit:create') ? (
            <Link href="/leads/insta" className="btn btn-accent">
              <Icon name="target" size={16} />
              Insta Lead
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

      <LeadFilters sources={sources} products={products} owners={owners} />

      {filteredEvent ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm">
          {/*
            The wording distinguishes the two lists. "Everyone we met" includes
            clients who were already on the book; "leads captured" is only what
            the event produced. Same event, different question, and a reader who
            cannot tell which one they are looking at will read the larger
            number as the event's performance.
          */}
          <span className="text-[var(--color-text-muted)]">
            {byAttendance ? 'Showing everyone we met at' : 'Showing leads captured at'}
          </span>
          <span className="font-semibold">{filteredEvent.name}</span>
          <Link
            href="/leads"
            className="ml-auto text-xs font-semibold text-[var(--color-text-muted)] underline underline-offset-2"
          >
            Show all leads
          </Link>
        </div>
      ) : null}

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
          <LeadTable leads={data.items} productLabels={productLabels} />
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
