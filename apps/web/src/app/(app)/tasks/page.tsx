import Link from 'next/link';
import type { Route } from 'next';

import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/shell/Icon';
import { PriorityBadge } from '@/components/ui/Badge';
import { Pagination } from '@/components/ui/Pagination';
import { StatTile } from '@/components/ui/StatTile';
import { TaskGridFilters } from '@/components/tasks/TaskGridFilters';
import type { ProductItem } from '@sihl-one/contracts';

import { ProductChips } from '@/components/ui/ProductChips';
import { apiFetch, toQuery } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { formatDateTime, formatRelative } from '@/lib/format';
import { istDayKey } from '@/lib/time';

export const metadata = { title: 'Tasks' };

/** Asked for by the business: 25 rows to a page. */
const PAGE_SIZE = 25;

interface TaskRow {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueAt: string;
  isOverdue: boolean;
  entityType: string | null;
  entityId: string | null;
  assignee: { id: string; fullName: string } | null;
  /** From the linked lead, so a rep can triage without opening each task. */
  productInterest: string[];
  /** Who the task is about. Null when it hangs off something other than a lead. */
  about: { name: string; mobileMasked: string; reference: string } | null;
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const params = await searchParams;

  const [summary, data, products, colleagues] = await Promise.all([
    apiFetch<{ open: number; overdue: number; dueToday: number; completedThisWeek: number }>(
      '/tasks/summary',
    ),
    apiFetch<{ items: TaskRow[]; total: number; page: number; pageSize: number }>(
      `/tasks${toQuery({
        status: (params.status as string | undefined) ?? 'OPEN',
        overdueOnly: params.overdueOnly as string | undefined,
        // Every column filter travels through as-is; the API ANDs them.
        reference: params.reference as string | undefined,
        title: params.title as string | undefined,
        client: params.client as string | undefined,
        priority: params.priority as string | undefined,
        assigneeId: params.assigneeId as string | undefined,
        dueFrom: params.dueFrom as string | undefined,
        dueTo: params.dueTo as string | undefined,
        page: (params.page as string | undefined) ?? '1',
        pageSize: String(PAGE_SIZE),
      })}`,
    ),
    apiFetch<ProductItem[]>('/masters/products').catch(() => [] as ProductItem[]),
    // Optional: the filter row degrades to a text-free assignee column rather
    // than failing the page if the directory cannot be read.
    apiFetch<Array<{ id: string; fullName: string }>>('/users/colleagues').catch(() => []),
  ]);

  const productLabels = Object.fromEntries(products.map((product) => [product.code, product.name]));

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Tasks</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Soonest due first — the order you should work them
        </p>
      </header>

      {/*
        The tiles are the filters.

        A row of buttons underneath repeated Open and Overdue word for word,
        so the screen asked the reader to choose between two controls that did
        the same thing. Three of the four tiles now carry the filter their
        number describes, which is the link somebody already expects to be
        there when they read a count.

        "Completed this week" stays a count. Its number is the last seven days
        and the old Completed button showed every completed task ever, so
        wiring one to the other would have put a list of 240 under a tile
        reading 12.
      */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Open" value={summary.open} href="/tasks" />
        <StatTile
          label="Overdue"
          value={summary.overdue}
          tone={summary.overdue > 0 ? 'danger' : 'default'}
          href="/tasks?overdueOnly=true"
        />
        {/*
          Today in IST, named explicitly rather than left to the server's own
          clock. The range filters widen a bare day to the IST day it names,
          so this matches the tile's count exactly.
        */}
        <StatTile
          label="Due today"
          value={summary.dueToday}
          href={`/tasks?dueFrom=${istDayKey()}&dueTo=${istDayKey()}`}
        />
        <StatTile label="Completed this week" value={summary.completedThisWeek} />
      </div>

      {data.items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Icon name="check" size={40} />}
            title="Nothing here"
            description="No tasks match this view. Follow-ups you schedule while logging an interaction will appear here."
          />
        </div>
      ) : (
        <>
          {/*
            A grid rather than cards.

            The list was read one row at a time; this is scanned down a
            column — all the overdue ones, everything for one client, one
            person's week. The horizontal scroll is kept on its own container
            so the page itself never scrolls sideways on a phone.
          */}
          <div className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] text-left">
                  <tr>
                    {['#', 'Task no.', 'Task', 'Client', 'Due', 'Priority', 'Assignee', ''].map(
                      (heading, index) => (
                        <th
                          key={heading || `action-${index}`}
                          scope="col"
                          className="whitespace-nowrap px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]"
                        >
                          {heading}
                        </th>
                      ),
                    )}
                  </tr>
                  <TaskGridFilters
                    assignees={colleagues.map((person) => ({
                      id: person.id,
                      name: person.fullName,
                    }))}
                  />
                </thead>

                <tbody className="divide-y divide-[var(--color-border)]">
                  {data.items.map((task, index) => (
                    <tr key={task.id} className="align-top hover:bg-[var(--color-surface-muted)]">
                      {/* Continues across pages, so row 26 is the 26th task
                          and not the first of page two over again. */}
                      <td className="tnum px-3 py-2.5 text-xs text-[var(--color-text-subtle)]">
                        {(data.page - 1) * data.pageSize + index + 1}
                      </td>

                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-[var(--color-text-muted)]">
                        {task.reference}
                      </td>

                      <td className="min-w-[14rem] px-3 py-2.5">
                        <span className="flex items-start gap-2">
                          <span
                            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                              task.isOverdue
                                ? 'bg-danger-500'
                                : task.status === 'DONE'
                                  ? 'bg-teal-500'
                                  : 'bg-navy-300'
                            }`}
                            aria-hidden
                          />
                          <span className="min-w-0">
                            <span
                              className={`block font-semibold ${
                                task.status === 'DONE'
                                  ? 'text-[var(--color-text-muted)] line-through'
                                  : ''
                              }`}
                            >
                              {task.title}
                            </span>
                            {task.description ? (
                              <span className="mt-0.5 block truncate text-xs text-[var(--color-text-muted)]">
                                {task.description}
                              </span>
                            ) : null}
                            {task.productInterest?.length ? (
                              <span className="mt-1 block">
                                <ProductChips
                                  codes={task.productInterest}
                                  labels={productLabels}
                                  tone="outline"
                                />
                              </span>
                            ) : null}
                          </span>
                        </span>
                      </td>

                      {/* The lead or customer number, asked for by name: it is
                          what a rep quotes to the back office. */}
                      <td className="min-w-[11rem] px-3 py-2.5">
                        {task.about ? (
                          <>
                            <span className="block truncate font-medium">{task.about.name}</span>
                            <span className="block font-mono text-xs text-[var(--color-text-muted)]">
                              {task.about.reference}
                            </span>
                            <span className="block font-mono text-xs tabular-nums text-[var(--color-text-subtle)]">
                              {task.about.mobileMasked}
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-[var(--color-text-subtle)]">&mdash;</span>
                        )}
                      </td>

                      <td
                        className={`whitespace-nowrap px-3 py-2.5 text-xs font-semibold ${
                          task.isOverdue ? 'text-danger-500' : 'text-[var(--color-text-muted)]'
                        }`}
                        title={formatDateTime(task.dueAt)}
                      >
                        {formatRelative(task.dueAt)}
                      </td>

                      <td className="px-3 py-2.5">
                        <PriorityBadge priority={task.priority} />
                      </td>

                      <td className="whitespace-nowrap px-3 py-2.5 text-xs text-[var(--color-text-muted)]">
                        {task.assignee?.fullName ?? '\u2014'}
                      </td>

                      <td className="whitespace-nowrap px-3 py-2.5">
                        {task.entityId &&
                        (task.entityType === 'LEAD' || task.entityType === 'CUSTOMER') ? (
                          <Link
                            href={
                              (task.entityType === 'LEAD'
                                ? `/leads/${task.entityId}`
                                : `/customers/${task.entityId}`) as Route
                            }
                            className="btn btn-outline h-8 text-xs"
                          >
                            {task.entityType === 'LEAD' ? 'Open lead' : 'Open customer'}
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <Pagination
            page={data.page}
            totalPages={Math.max(1, Math.ceil(data.total / data.pageSize))}
            total={data.total}
            pageSize={data.pageSize}
          />
        </>
      )}
    </div>
  );
}
