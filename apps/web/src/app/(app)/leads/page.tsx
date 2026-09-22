import Link from 'next/link';
import type { Route } from 'next';
import type { LeadListItem } from '@sihl-one/contracts';

import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/shell/Icon';
import { LeadFilters } from '@/components/leads/LeadFilters';
import { LeadSelectionProvider } from '@/components/leads/LeadSelection';
import { LeadTable } from '@/components/leads/LeadTable';
import { Pagination } from '@/components/ui/Pagination';
import type { LeadOwnerFilterOptions, LeadSourceItem, ProductItem } from '@sihl-one/contracts';
import { apiFetch, toQuery } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';
import { formatNumber } from '@/lib/format';

export const metadata = { title: 'Leads' };

/** Just enough of `/users/assignable` to fill the picker. */
interface Assignee {
  id: string;
  fullName: string;
}

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
    // The unowned pile. Not an id, so it needs its own parameter.
    owned: first('owned'),
    eventId: first('eventId'),
    attendedEventId: first('attendedEventId'),
    /*
      The event drill-downs.

      Every count on an event — a rep's row, a dashboard tile — links here with
      the filters it was counted from. Dropping any of them silently widens the
      list: the reader clicks a four and lands on four hundred, with nothing on
      screen admitting the filter was discarded. Anything the API's LeadQuery
      accepts and a link can set has to be forwarded here.
    */
    capturedById: first('capturedById'),
    captured: first('captured'),
    returningAtEventId: first('returningAtEventId'),
    mobileVerified: first('mobileVerified'),
    // Same story from the other two places that link here: a campaign's "View
    // leads" and a partner's "View all leads". The partner page makes it
    // plainest — its own panel calls the API directly and counts correctly, so
    // the reader sees "8 of 23", clicks through, and lands on the whole book.
    campaignId: first('campaignId'),
    partnerId: first('partnerId'),
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

      From the leads themselves, not the user directory. The first version asked
      the assignable-users endpoint, which answers "who may I hand work to" — for
      a team-scoped manager that is their own team, so the filter listed a
      handful of names while the table below showed leads owned by dozens of
      other people, with no way to reach them.

      Needs only `lead:read`, so it no longer depends on holding `user:read`.
      A sales executive owns everything in their own scope, so the list comes
      back with just them and the control hides itself.
    */
    apiFetch<LeadOwnerFilterOptions | LeadOwnerFilterOptions['items']>('/leads/owners').catch(
      () => ({ items: [], hasUnassigned: false }) as LeadOwnerFilterOptions,
    ),
  ]);

  /*
    This endpoint used to return the array directly and now returns
    `{ items, hasUnassigned }`. Both shapes are read, because web and API do not
    restart in the same instant: during that window the new page calls the old
    endpoint, `.items` is undefined, and the owner filter disappears from the
    screen with nothing logged. A silently vanishing control is the worst kind
    of failure — it looks like a decision rather than a fault.
  */
  const ownerOptions: LeadOwnerFilterOptions = Array.isArray(owners)
    ? { items: owners, hasUnassigned: false }
    : owners;

  /*
    Bulk assignment, and only where it makes sense.

    Two lists show work nobody is doing: leads held by no owner (`owned=none`)
    and leads no rep's QR brought in (`captured=none` — the event breakdown's
    unattributed row). Those are the screens where picking a batch and handing
    it to somebody is the obvious next move, so the tick boxes appear there and
    nowhere else. `lead:assign` still decides whether any of it is allowed; this
    only decides whether to offer it.
  */
  const unownedView = first('owned') === 'none' || first('captured') === 'none';
  const canBulkAssign = unownedView && can(user, 'lead:assign');

  const [data, assignees] = await Promise.all([
    apiFetch<Paginated>(`/leads${query}`),
    // Who may receive work. Not the owner filter's list — that one is derived
    // from leads and answers "whose are these"; this answers "who may I hand
    // these to", which is a different question with a different answer.
    canBulkAssign
      ? apiFetch<Assignee[]>('/users/assignable').catch(() => [] as Assignee[])
      : Promise.resolve([] as Assignee[]),
  ]);

  // Named, not just applied. Arriving from an event's "View the leads" with a
  // silent filter looks identical to a broken list — the reader has no way to
  // tell "this event produced three leads" from "the search is wrong".
  //
  // Three filters name an event, and every one of them has to count: whichever
  // tile was clicked, the reader came from that event's page and needs the way
  // back. Leaving one out strands them on a list with no route home and no
  // label saying which event it belongs to.
  const capturedAt = first('eventId');
  const attendedAt = first('attendedEventId');
  const returningAt = first('returningAtEventId');
  const eventId = capturedAt ?? attendedAt ?? returningAt;
  const eventLens = attendedAt ? 'attended' : returningAt ? 'returning' : 'captured';
  const filteredEvent = eventId
    ? await apiFetch<{ id: string; name: string }>(`/events/${eventId}`).catch(() => null)
    : null;
  // Chips show the master's name rather than a title-cased code, so NRI does
  // not render as "Nri" and MUTUAL_FUNDS reads however the business named it.
  const productLabels = Object.fromEntries(products.map((p) => [p.code, p.name]));
  const hasFilters = Boolean(
    first('q') ||
    params.status ||
    params.source ||
    params.productInterest ||
    first('priority') ||
    first('overdueOnly') ||
    first('minScore') ||
    first('ownerId') ||
    first('owned') ||
    first('capturedById') ||
    first('captured') ||
    first('mobileVerified') ||
    first('campaignId') ||
    first('partnerId'),
  );

  /*
    Only the unowned rows are selectable, so only they are offered to the
    provider. Select-all then means "every lead here that nobody holds" rather
    than everything on the page — the API enforces the same rule, but a
    select-all that silently dropped half of what it ticked would still be a lie
    on screen.
  */
  return (
    <LeadSelectionProvider
      ids={canBulkAssign ? data.items.filter((lead) => !lead.owner).map((lead) => lead.id) : []}
    >
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
          <div className="flex flex-wrap items-center gap-2">
            {/*
            Back to the event, when that is where the reader came from.

            First in the row and set apart, because it is the way out rather
            than another thing to do here — and somebody comparing two reps
            makes this trip repeatedly.
          */}
            {filteredEvent ? (
              <>
                <Link href={`/events/${filteredEvent.id}` as Route} className="btn btn-outline">
                  ← Back to {filteredEvent.name}
                </Link>
                <span className="mx-1 hidden h-6 w-px bg-[var(--color-border)] sm:inline-block" />
              </>
            ) : null}
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
            {/*
            Export takes the filters currently applied, so the file matches the
            screen. `lead:export` is a separate grant from `lead:read` — reading
            a screenful and walking out with the book are different acts, and
            the API audits the second.
          */}
            {can(user, 'lead:export') ? (
              <a href={`/api/leads/export${query}`} className="btn btn-outline" download>
                <Icon name="file" size={16} />
                Export CSV
              </a>
            ) : null}
            {can(user, 'lead:create') ? (
              <Link href="/leads/new" className="btn btn-primary">
                <Icon name="plus" size={16} />
                New lead
              </Link>
            ) : null}
          </div>
        </header>

        <LeadFilters
          sources={sources}
          products={products}
          owners={ownerOptions.items}
          hasUnassigned={ownerOptions.hasUnassigned}
          assignees={assignees.map((person) => ({ id: person.id, fullName: person.fullName }))}
        />

        {filteredEvent ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm">
            {/*
            The wording distinguishes the three lists. "Everyone we met"
            includes clients who were already on the book; "leads captured" is
            only what the event produced; "already on the book" is the subset
            who walked up as existing clients. Same event, three different
            questions, and a reader who cannot tell which one they are looking
            at will read the largest number as the event's performance.
          */}
            <span className="text-[var(--color-text-muted)]">
              {eventLens === 'attended'
                ? 'Showing everyone we met at'
                : eventLens === 'returning'
                  ? 'Showing clients already on the book who came to'
                  : 'Showing leads captured at'}
            </span>
            <span className="font-semibold">{filteredEvent.name}</span>

            {/* The way back is a button in the header now, so this keeps only
              the escape from the filter itself. */}
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
            <LeadTable
              leads={data.items}
              productLabels={productLabels}
              selectable={canBulkAssign}
            />
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              total={data.total}
              pageSize={data.pageSize}
            />
          </>
        )}
      </div>
    </LeadSelectionProvider>
  );
}
