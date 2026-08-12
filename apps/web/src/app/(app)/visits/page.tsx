import Link from 'next/link';
import type { VisitListItem } from '@sihl-one/contracts';

import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/shell/Icon';
import { StatTile } from '@/components/ui/StatTile';
import { apiFetch, toQuery } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { formatDateTime, formatRelative, humanise } from '@/lib/format';

export const metadata = { title: 'Visits' };

interface TodayView {
  inProgress: VisitListItem | null;
  planned: VisitListItem[];
  completedToday: number;
}

const STATUS_TONE: Record<string, 'blue' | 'amber' | 'green' | 'neutral' | 'red'> = {
  PLANNED: 'blue',
  CHECKED_IN: 'amber',
  COMPLETED: 'green',
  CANCELLED: 'neutral',
  MISSED: 'red',
};

/**
 * Field-sales home.
 *
 * Built mobile-first because this is the one screen used standing in a car park
 * on a phone. The open visit, if there is one, is the single largest thing on
 * the page — resuming it is the only action that matters at that moment.
 */
export default async function VisitsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireUser();
  const params = await searchParams;

  const [today, history] = await Promise.all([
    apiFetch<TodayView>('/visits/today'),
    apiFetch<{ items: VisitListItem[]; total: number }>(
      `/visits${toQuery({
        status: params.status,
        needsReview: params.needsReview,
        pageSize: '25',
      })}`,
    ),
  ]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Visits</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Check in when you arrive, check out when you leave. Nothing is recorded in between.
          </p>
        </div>
        <Link href="/visits/new" className="btn btn-primary">
          <Icon name="plus" size={16} />
          Plan a visit
        </Link>
      </header>

      {today.inProgress ? (
        <section
          aria-label="Visit in progress"
          className="card border-l-[4px] border-l-warn-500 p-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Badge tone="amber">Checked in</Badge>
              <h2 className="mt-2 text-lg font-bold">
                {today.inProgress.entityName ?? 'Visit'}
              </h2>
              <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
                {today.inProgress.purpose}
              </p>
              <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
                Checked in {formatRelative(today.inProgress.checkInAt)}
              </p>
            </div>
            <Link href={`/visits/${today.inProgress.id}`} className="btn btn-accent">
              Check out
            </Link>
          </div>
        </section>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Planned today" value={today.planned.length} />
        <StatTile label="Completed today" value={today.completedToday} />
        <StatTile
          label="In progress"
          value={today.inProgress ? 1 : 0}
          tone={today.inProgress ? 'warning' : 'default'}
        />
      </div>

      <section>
        <h2 className="mb-2 font-bold">Today’s plan</h2>
        {today.planned.length === 0 ? (
          <div className="card">
            <EmptyState
              icon={<Icon name="pin" size={36} />}
              title="Nothing planned"
              description="Plan a visit against a lead or customer and it will appear here."
              action={
                <Link href="/visits/new" className="btn btn-primary">
                  Plan a visit
                </Link>
              }
            />
          </div>
        ) : (
          <ul className="space-y-2">
            {today.planned.map((visit) => (
              <li key={visit.id}>
                <Link href={`/visits/${visit.id}`} className="card block p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{visit.entityName ?? 'Visit'}</p>
                      <p className="mt-0.5 truncate text-sm text-[var(--color-text-muted)]">
                        {visit.purpose}
                      </p>
                    </div>
                    <Badge tone={visit.isOverdue ? 'red' : 'blue'}>
                      {visit.isOverdue ? 'Overdue' : 'Planned'}
                    </Badge>
                  </div>
                  {visit.plannedAt ? (
                    <p className="mt-2 text-xs text-[var(--color-text-subtle)]">
                      {formatDateTime(visit.plannedAt)}
                    </p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-bold">Recent visits</h2>
          <Link
            href="/visits?needsReview=true"
            className="text-xs font-semibold text-teal-600 hover:underline dark:text-teal-300"
          >
            Needs review
          </Link>
        </div>

        {history.items.length === 0 ? (
          <div className="card">
            <EmptyState title="No visits yet" description="Completed visits appear here." />
          </div>
        ) : (
          <ul className="space-y-2">
            {history.items.map((visit) => (
              <li key={visit.id}>
                <Link href={`/visits/${visit.id}`} className="card block p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{visit.entityName ?? 'Visit'}</p>
                      <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">
                        {visit.reference}
                        {visit.user ? ` · ${visit.user.fullName}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {visit.requiresReview ? <Badge tone="amber">Needs review</Badge> : null}
                      <Badge tone={STATUS_TONE[visit.status] ?? 'neutral'}>
                        {humanise(visit.status)}
                      </Badge>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
                    {visit.checkInAt ? <span>{formatDateTime(visit.checkInAt)}</span> : null}
                    {visit.durationMinutes !== null ? (
                      <span>{visit.durationMinutes} min</span>
                    ) : null}
                    {visit.outcome ? <span>{visit.outcome}</span> : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
