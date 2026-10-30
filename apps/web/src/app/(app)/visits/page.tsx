import Link from 'next/link';
import type { Route } from 'next';
import type { VisitListItem } from '@sihl-one/contracts';

import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/shell/Icon';
import { StatTile } from '@/components/ui/StatTile';
import { ReviewVisitButton } from '@/components/visits/ReviewVisitButton';
import { VisitSearch } from '@/components/visits/VisitSearch';
import { apiFetch, toQuery } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { formatDateTime, formatRelative, humanise } from '@/lib/format';

export const metadata = { title: 'Visits' };

interface TodayView {
  inProgress: VisitListItem | null;
  planned: VisitListItem[];
  completedToday: number;
  /** Planned visits whose time has passed, across the whole book. */
  overdue: number;
  /** Everything still to do: planned plus in progress. */
  openTotal: number;
}

/** The three slices of the book the buttons offer. */
const VIEWS = [
  { value: 'OPEN', label: 'Open items' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'COMPLETED_7D', label: 'Completed in last 7 days' },
] as const;

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
        // Open by default: this screen is a worklist, not an archive.
        view: params.view ?? 'OPEN',
        q: params.q,
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

      {/*
        Every tile is a filter.

        They were counts you could read and not act on, so a rep who saw
        "3 overdue" still had to go and find them. Each now links to the list
        it is counting.
      */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Open items" value={today.openTotal} href="/visits?view=OPEN" />
        <StatTile
          label="Overdue"
          value={today.overdue}
          tone={today.overdue > 0 ? 'danger' : 'default'}
          href="/visits?view=OVERDUE"
        />
        <StatTile
          label="In progress"
          value={today.inProgress ? 1 : 0}
          tone={today.inProgress ? 'warning' : 'default'}
          href="/visits?view=OPEN&status=CHECKED_IN"
        />
        <StatTile
          label="Completed today"
          value={today.completedToday}
          href="/visits?view=COMPLETED_7D"
        />
      </div>

      {/* The same three slices as buttons, plus the search, so the list can be
          narrowed without going back up to a tile. */}
      <div className="card flex flex-wrap items-center gap-3 p-3">
        <div className="flex flex-wrap gap-1">
          {VIEWS.map((option) => {
            const active = (params.view ?? 'OPEN') === option.value && !params.needsReview;
            return (
              <Link
                key={option.value}
                href={`/visits?view=${option.value}` as Route}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                  active
                    ? 'bg-teal-600 text-white'
                    : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]'
                }`}
              >
                {option.label}
              </Link>
            );
          })}
          <Link
            href={'/visits?needsReview=true' as Route}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
              params.needsReview === 'true'
                ? 'bg-amber-600 text-white'
                : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]'
            }`}
          >
            Needs review
          </Link>
        </div>
        <div className="flex-1 sm:text-right">
          <VisitSearch />
        </div>
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
                  {/* The mode decides what check-in will demand — a photo, a
                      location, a meeting link — so it belongs next to the time,
                      not one tap away. */}
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-subtle)]">
                    {visit.plannedAt ? <span>{formatDateTime(visit.plannedAt)}</span> : null}
                    <span>{visit.modeLabel ?? humanise(visit.mode)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-bold">
            {params.needsReview === 'true'
              ? 'Needs review'
              : (VIEWS.find((option) => option.value === (params.view ?? 'OPEN'))?.label ??
                'Visits')}
          </h2>
          <p className="text-xs text-[var(--color-text-muted)]">
            {history.total} {history.total === 1 ? 'visit' : 'visits'}
          </p>
        </div>

        {history.items.length === 0 ? (
          <div className="card">
            <EmptyState title="No visits yet" description="Completed visits appear here." />
          </div>
        ) : (
          <ul className="space-y-2">
            {history.items.map((visit, index) => (
              <li key={visit.id} className="card p-4">
                <Link href={`/visits/${visit.id}`} className="block">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2.5">
                      {/* Numbered, so a visit can be referred to by position
                          in a conversation about the list. */}
                      <span className="tnum mt-0.5 text-xs text-[var(--color-text-subtle)]">
                        {index + 1}.
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{visit.entityName ?? 'Visit'}</p>
                        <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">
                          {visit.reference}
                          {visit.user ? ` · ${visit.user.fullName}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {visit.requiresReview ? (
                        visit.reviewedAt ? (
                          // Still flagged — the geometry has not changed —
                          // but somebody has accepted it, so it reads as
                          // settled rather than outstanding.
                          <Badge tone="neutral">
                            Reviewed{visit.reviewedBy ? ` · ${visit.reviewedBy}` : ''}
                          </Badge>
                        ) : (
                          <Badge tone="amber">Needs review</Badge>
                        )
                      ) : null}
                      <Badge tone={STATUS_TONE[visit.status] ?? 'neutral'}>
                        {humanise(visit.status)}
                      </Badge>
                    </div>
                  </div>

                  {/* A visit that has not happened yet has no check-in time,
                      duration or outcome, so this row used to be empty for
                      exactly the visits a rep still has to act on — they had to
                      open each one to find out when it was. Planned rows show
                      when they are due instead, labelled so a future time is
                      never mistaken for a time something happened. */}
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
                    {visit.checkInAt ? (
                      <span>{formatDateTime(visit.checkInAt)}</span>
                    ) : visit.plannedAt ? (
                      <span className={visit.isOverdue ? 'font-semibold text-danger-600' : undefined}>
                        {visit.isOverdue ? 'Overdue' : 'Planned'} · {formatDateTime(visit.plannedAt)}
                      </span>
                    ) : null}
                    <span>{visit.modeLabel ?? humanise(visit.mode)}</span>
                    {visit.durationMinutes !== null ? (
                      <span>{visit.durationMinutes} min</span>
                    ) : null}
                    {visit.outcome ? <span>{visit.outcome}</span> : null}
                  </div>
                </Link>

                {/*
                  Through to the client, outside the card's own link so the
                  two do not nest. A visit always knows its subject, but the
                  row offered no way to reach it — a rep reading "overdue"
                  had to go and search for the lead by hand.
                */}
                {/* Outstanding reviews get the control that clears them. */}
                {visit.requiresReview && !visit.reviewedAt ? (
                  <div className="mt-2.5 border-t border-[var(--color-border)] pt-2.5">
                    <ReviewVisitButton visitId={visit.id} />
                  </div>
                ) : null}

                {visit.entityId &&
                (visit.entityType === 'LEAD' || visit.entityType === 'CUSTOMER') ? (
                  <div className="mt-2.5 border-t border-[var(--color-border)] pt-2.5">
                    <Link
                      href={
                        (visit.entityType === 'LEAD'
                          ? `/leads/${visit.entityId}`
                          : `/customers/${visit.entityId}`) as Route
                      }
                      className="btn btn-outline h-8 text-xs"
                    >
                      {visit.entityType === 'LEAD' ? 'Open lead' : 'Open customer'}
                    </Link>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
