import Link from 'next/link';
import type { Route } from 'next';
import type { TrainingView } from '@sihl-one/contracts';

import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/shell/Icon';
import { apiFetch, toQuery } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';
import { formatDateTime, formatNumber } from '@/lib/format';

export const metadata = { title: 'Training' };

const SCOPES = [
  { value: 'UPCOMING', label: 'Upcoming' },
  { value: 'PAST', label: 'Past' },
  { value: 'ALL', label: 'All' },
] as const;

export default async function TrainingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const scope = SCOPES.some((option) => option.value === params.scope)
    ? (params.scope as string)
    : 'UPCOMING';

  /*
    Reading needs no permission.

    A session is announced to the branches it is for, and hiding the list from
    the people expected to attend would defeat the point of announcing it. Only
    scheduling is gated.
  */
  const sessions = await apiFetch<TrainingView[]>(
    `/training${toQuery({ scope, q: params.q })}`,
  ).catch(() => [] as TrainingView[]);

  const canManage = can(user, 'training:manage');
  const isFiltered = Boolean(params.q);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Training</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {formatNumber(sessions.length)} {sessions.length === 1 ? 'session' : 'sessions'} ·
            scheduled per branch, with the material attached
          </p>
        </div>
        {canManage ? (
          <Link href="/training/new" className="btn btn-primary">
            <Icon name="plus" size={16} />
            Schedule a session
          </Link>
        ) : null}
      </header>

      <div className="card flex flex-wrap items-center gap-3 p-3">
        <div className="flex gap-1">
          {SCOPES.map((option) => (
            <Link
              key={option.value}
              href={`/training${toQuery({ scope: option.value, q: params.q })}` as Route}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                scope === option.value
                  ? 'bg-teal-600 text-white'
                  : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]'
              }`}
            >
              {option.label}
            </Link>
          ))}
        </div>

        {/* GET, so the scope survives a search and the URL stays shareable. */}
        <form className="flex flex-1 gap-2" action="/training">
          <input type="hidden" name="scope" value={scope} />
          <input
            name="q"
            defaultValue={params.q ?? ''}
            placeholder="Search topic or presenter"
            className="input flex-1 sm:max-w-xs"
            aria-label="Search training"
          />
          <button type="submit" className="btn btn-outline">
            Search
          </button>
        </form>
      </div>

      {sessions.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Icon name="users" size={40} />}
            title={
              isFiltered
                ? 'No sessions match that search'
                : scope === 'PAST'
                  ? 'Nothing has run yet'
                  : 'No sessions scheduled'
            }
            description={
              isFiltered
                ? 'Try a shorter search, or clear it.'
                : 'Schedule one and it appears for every branch you pick.'
            }
            action={
              isFiltered ? (
                <Link href="/training" className="btn btn-outline">
                  Clear search
                </Link>
              ) : canManage ? (
                <Link href="/training/new" className="btn btn-primary">
                  Schedule the first session
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] text-left">
                <tr>
                  {['Topic', 'When', 'Presenter', 'Branches', 'Material', 'Status'].map(
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
                {sessions.map((session) => (
                  <tr key={session.id} className="hover:bg-[var(--color-surface-muted)]">
                    <td className="px-4 py-3">
                      <Link
                        href={`/training/${session.id}` as Route}
                        className="font-semibold hover:text-teal-600 hover:underline dark:hover:text-teal-300"
                      >
                        {session.topic}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                      {formatDateTime(session.startsAt)}
                      <div className="text-[var(--color-text-subtle)]">
                        {session.durationMinutes} min
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                      {session.presenterName ?? '—'}
                    </td>
                    {/* The count, not the names: forty branch names in a cell
                        pushes every other column off the screen. */}
                    <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                      {session.branches.length === 1
                        ? session.branches[0].name
                        : `${session.branches.length} branches`}
                    </td>
                    <td className="px-4 py-3 tnum text-xs text-[var(--color-text-muted)]">
                      {session.material.length === 0 ? '—' : formatNumber(session.material.length)}
                    </td>
                    <td className="px-4 py-3">
                      {session.status === 'CANCELLED' ? (
                        <Badge tone="neutral">Cancelled</Badge>
                      ) : session.editable ? (
                        <Badge tone="navy">Scheduled</Badge>
                      ) : (
                        <Badge tone="teal">Done</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
