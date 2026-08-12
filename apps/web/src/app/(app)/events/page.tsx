import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { EventListItem } from '@sihl-one/contracts';

import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { EventFilters } from '@/components/events/EventFilters';
import { Icon } from '@/components/shell/Icon';
import { Pagination } from '@/components/ui/Pagination';
import { apiFetch, toQuery } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';
import { formatDate, formatNumber, humanise } from '@/lib/format';

export const metadata = { title: 'Events' };

const STATUS_TONES: Record<string, 'green' | 'navy' | 'teal' | 'neutral'> = {
  PLANNED: 'navy',
  RUNNING: 'green',
  COMPLETED: 'teal',
  CANCELLED: 'neutral',
};

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user, 'campaign:read')) redirect('/dashboard');

  const params = await searchParams;
  const data = await apiFetch<{
    items: EventListItem[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  }>(
    `/events${toQuery({
      q: params.q,
      status: params.status,
      page: params.page ?? '1',
      pageSize: '20',
    })}`,
  );

  const isFiltered = Boolean(params.q || params.status);
  const canCreate = can(user, 'campaign:create');

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Events</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {formatNumber(data.total)} {data.total === 1 ? 'event' : 'events'} · each carries its
            own QR, and every scan lands as an attributed lead
          </p>
        </div>
        {canCreate ? (
          <Link href="/events/new" className="btn btn-primary">
            <Icon name="plus" size={16} />
            New event
          </Link>
        ) : null}
      </header>

      <EventFilters />

      {data.items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Icon name="pin" size={40} />}
            title={isFiltered ? 'No events match those filters' : 'No events yet'}
            description={
              isFiltered
                ? 'Try widening the search, or clear the filters.'
                : 'Create an event to get a QR code your team can print and put on the desk.'
            }
            action={
              isFiltered ? (
                <Link href="/events" className="btn btn-outline">
                  Clear filters
                </Link>
              ) : canCreate ? (
                <Link href="/events/new" className="btn btn-primary">
                  Create the first event
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
                    {['Event', 'Status', 'When', 'Where', 'Captured', 'Converted'].map((heading) => (
                      <th
                        key={heading}
                        scope="col"
                        className="px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {data.items.map((event) => (
                    <tr key={event.id} className="hover:bg-[var(--color-surface-muted)]">
                      <td className="px-4 py-3">
                        <Link
                          href={`/events/${event.id}`}
                          className="font-semibold hover:text-teal-600 hover:underline dark:hover:text-teal-300"
                        >
                          {event.name}
                        </Link>
                        <div className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">
                          {event.code}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={STATUS_TONES[event.status] ?? 'neutral'}>
                          {humanise(event.status)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                        {formatDate(event.startsAt)}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                        {event.venue ?? event.city ?? '—'}
                      </td>
                      <td className="px-4 py-3 tnum">{formatNumber(event.leads)}</td>
                      <td className="px-4 py-3 tnum">{formatNumber(event.converted)}</td>
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
