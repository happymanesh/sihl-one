import Link from 'next/link';
import type { Route } from 'next';
import type { VisitListItem } from '@sihl-one/contracts';

import { Badge, PriorityBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/shell/Icon';
import { apiFetch, toQuery } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';
import { formatTime } from '@/lib/format';
import { istDayKey } from '@/lib/time';

export const metadata = { title: 'My day' };

/**
 * One agenda, from two systems of record.
 *
 * Tasks and Visits stay separate — they are different things, and CR-26 says
 * why at length. A task is an intention; a visit is evidence that somebody was
 * somewhere. They have different lifecycles, different evidence, and two
 * definitions of "overdue" that are each correct for their own kind of work.
 *
 * What was genuinely duplicated was the asking. A rep wanting to know what
 * today looks like had to open two menu items, read two sets of tiles and
 * reconcile two vocabularies. This reads both lists and interleaves them by
 * time; it writes nothing, owns nothing, and every row opens the record it
 * came from. Delete this file and neither module notices.
 */

interface TaskRow {
  id: string;
  reference: string;
  title: string;
  status: string;
  priority: string;
  dueAt: string;
  isOverdue: boolean;
  entityType: string | null;
  entityId: string | null;
  about: { name: string; mobileMasked: string; reference: string } | null;
}

interface Paged<T> {
  items: T[];
  total: number;
}

/** One row of the agenda, whichever list it came from. */
interface AgendaEntry {
  kind: 'TASK' | 'VISIT';
  id: string;
  /** When it is meant to happen. Drives the ordering and nothing else. */
  at: string | null;
  reference: string;
  title: string;
  /** The client or lead it concerns, when there is one. */
  about: string | null;
  status: string;
  late: boolean;
  priority: string | null;
  href: Route;
}

/**
 * Both lists are capped.
 *
 * A day with more than this is not a day anyone is going to work through a
 * screen at a time, and an uncapped fetch on a busy book turns a landing page
 * into the slowest thing in the product.
 */
const PER_LIST = 50;

export default async function MyDayPage() {
  const user = await requireUser();
  const today = istDayKey();

  /*
    Asked for as one IST day on both sides.

    Both query schemas widen a bare date to the IST day it names, so the two
    lists agree about where today begins. They did not always: the visit
    filter read a plain date as UTC midnight until this was built.
  */
  const [tasks, visits] = await Promise.all([
    apiFetch<Paged<TaskRow>>(
      `/tasks${toQuery({ dueFrom: today, dueTo: today, pageSize: String(PER_LIST) })}`,
    ).catch(() => ({ items: [], total: 0 }) as Paged<TaskRow>),
    apiFetch<Paged<VisitListItem>>(
      `/visits${toQuery({ from: today, to: today, pageSize: String(PER_LIST) })}`,
    ).catch(() => ({ items: [], total: 0 }) as Paged<VisitListItem>),
  ]);

  // One instant for the whole render, so two rows cannot be judged against
  // clocks a few milliseconds apart.
  const now = new Date().toISOString();

  const entries: AgendaEntry[] = [
    ...tasks.items.map((task) => ({
      kind: 'TASK' as const,
      id: task.id,
      at: task.dueAt,
      reference: task.reference,
      title: task.title,
      about: task.about?.name ?? null,
      status: task.status,
      late: task.isOverdue,
      priority: task.priority,
      href: '/tasks' as Route,
    })),
    ...visits.items.map((visit) => {
      // Pulled out so the null check narrows the type, rather than asserting
      // past it on the comparison below.
      const plannedAt = visit.plannedAt;
      return {
        kind: 'VISIT' as const,
        id: visit.id,
        at: plannedAt ?? visit.checkInAt,
        reference: visit.reference,
        title: visit.purpose,
        about: visit.entityName,
        status: visit.status,
        /*
          A visit is late once its appointment *time* has passed — a different
          rule from a task's, which waits for the whole day to end, and
          deliberately so. See CR-26: it is the clearest evidence that these
          are two kinds of work rather than one.

          Comparing ISO strings is safe here because both sides are UTC and
          fixed-width, so lexical order is chronological order.
        */
        late: visit.status === 'PLANNED' && plannedAt !== null && plannedAt < now,
        priority: null,
        href: `/visits/${visit.id}` as Route,
      };
    }),
  ].sort((a, b) => {
    // Anything without a time sinks to the bottom rather than sorting as the
    // epoch, which would put it above the eight o'clock call.
    if (!a.at) return 1;
    if (!b.at) return -1;
    return a.at.localeCompare(b.at);
  });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">My day</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Everything due today, in the order it falls — tasks and visits together
          </p>
        </div>

        {/* Top of the screen, because the commonest reason to be looking at
            today is that somebody new has just come up in it. */}
        {can(user, 'lead:create') ? (
          <Link href={'/leads/new' as Route} className="btn btn-primary">
            <Icon name="plus" size={16} />
            Add lead
          </Link>
        ) : null}
      </header>

      {entries.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Icon name="check" size={40} />}
            title="Nothing scheduled for today"
            description="Tasks you are due to finish and visits you have planned for today will appear here together."
          />
        </div>
      ) : (
        <div className="card overflow-hidden p-0">
          <ul className="divide-y divide-[var(--color-border)]">
            {entries.map((entry) => (
              <li key={`${entry.kind}-${entry.id}`}>
                <Link
                  href={entry.href}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 hover:bg-[var(--color-surface-muted)]"
                >
                  {/* The time carries the ordering, so it reads first and in
                      figures that line up down the column. */}
                  <span
                    className={`w-16 shrink-0 text-sm font-semibold tnum ${
                      entry.late ? 'text-danger-600' : 'text-[var(--color-text-muted)]'
                    }`}
                  >
                    {entry.at ? formatTime(entry.at) : '—'}
                  </span>

                  <Badge tone={entry.kind === 'VISIT' ? 'teal' : 'navy'}>
                    {entry.kind === 'VISIT' ? 'Visit' : 'Task'}
                  </Badge>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{entry.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">
                      <span className="font-mono">{entry.reference}</span>
                      {entry.about ? ` · ${entry.about}` : ''}
                    </span>
                  </span>

                  {entry.late ? <Badge tone="red">Late</Badge> : null}
                  {entry.priority === 'HIGH' || entry.priority === 'URGENT' ? (
                    <PriorityBadge priority={entry.priority} />
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Said plainly rather than left for somebody to discover: this screen is
          a view, and the two modules remain where the work is actually done. */}
      <p className="text-xs text-[var(--color-text-subtle)]">
        {tasks.items.length} {tasks.items.length === 1 ? 'task' : 'tasks'} · {visits.items.length}{' '}
        {visits.items.length === 1 ? 'visit' : 'visits'}. Open{' '}
        <Link href={'/tasks' as Route} className="underline underline-offset-2">
          Tasks
        </Link>{' '}
        or{' '}
        <Link href={'/visits' as Route} className="underline underline-offset-2">
          Visits
        </Link>{' '}
        to work through either in full.
      </p>
    </div>
  );
}
