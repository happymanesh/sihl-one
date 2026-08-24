import Link from 'next/link';
import type { Route } from 'next';

import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/shell/Icon';
import { PriorityBadge } from '@/components/ui/Badge';
import { StatTile } from '@/components/ui/StatTile';
import type { ProductItem } from '@sihl-one/contracts';

import { ProductChips } from '@/components/ui/ProductChips';
import { apiFetch, toQuery } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { formatDateTime, formatRelative } from '@/lib/format';

export const metadata = { title: 'Tasks' };

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

  const [summary, data, products] = await Promise.all([
    apiFetch<{ open: number; overdue: number; dueToday: number; completedThisWeek: number }>(
      '/tasks/summary',
    ),
    apiFetch<{ items: TaskRow[]; total: number }>(
      `/tasks${toQuery({
        status: (params.status as string | undefined) ?? 'OPEN',
        overdueOnly: params.overdueOnly as string | undefined,
        pageSize: '50',
      })}`,
    ),
    apiFetch<ProductItem[]>('/masters/products').catch(() => [] as ProductItem[]),
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Open" value={summary.open} />
        <StatTile
          label="Overdue"
          value={summary.overdue}
          tone={summary.overdue > 0 ? 'danger' : 'default'}
          href="/tasks?overdueOnly=true"
        />
        <StatTile label="Due today" value={summary.dueToday} />
        <StatTile label="Completed this week" value={summary.completedThisWeek} />
      </div>

      <div className="flex gap-2">
        <FilterLink href={"/tasks" as Route} label="Open" active={!params.status && !params.overdueOnly} />
        <FilterLink href={"/tasks?overdueOnly=true" as Route} label="Overdue" active={params.overdueOnly === 'true'} />
        <FilterLink href={"/tasks?status=DONE" as Route} label="Completed" active={params.status === 'DONE'} />
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
        // Two groups rather than five siblings in one wrapping row. The title
        // used to sit in a `flex-1 min-w-0` cell beside four items that never
        // shrink, so on a phone it collapsed to a sliver and broke "Follow up
        // with Parth Chauhan" one word per line. The title now owns the full
        // width until there is room for more.
        <ul className="space-y-2">
          {data.items.map((task) => (
            <li
              key={task.id}
              className="card flex flex-wrap items-center gap-x-3 gap-y-2 p-3.5"
            >
              <div className="flex w-full min-w-0 items-start gap-3 sm:w-auto sm:flex-1">
                <span
                  className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                    task.isOverdue
                      ? 'bg-danger-500'
                      : task.status === 'DONE'
                        ? 'bg-teal-500'
                        : 'bg-navy-300'
                  }`}
                  aria-hidden
                />

                <div className="min-w-0 flex-1">
                <p
                  className={`font-semibold ${
                    task.status === 'DONE' ? 'text-[var(--color-text-muted)] line-through' : ''
                  }`}
                >
                  {task.title}
                </p>
                {/* Who to call, directly under the title. A follow-up reading
                    only "Follow up: collect document" left the rep opening the
                    task to find out who it was about. Number is masked, as on
                    every list. */}
                {task.about ? (
                  <p className="mt-0.5 truncate text-sm">
                    <span className="font-medium">{task.about.name}</span>
                    <span className="text-[var(--color-text-muted)]">
                      {' · '}
                      <span className="font-mono tabular-nums">{task.about.mobileMasked}</span>
                    </span>
                  </p>
                ) : null}
                {task.description ? (
                  <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">
                    {task.description}
                  </p>
                ) : null}
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-subtle)]">
                  <span className="font-mono">{task.reference}</span>
                  {task.assignee ? <span>· {task.assignee.fullName}</span> : null}
                  {task.productInterest?.length ? (
                    <ProductChips
                      codes={task.productInterest}
                      labels={productLabels}
                      tone="outline"
                    />
                  ) : null}
                </div>
                </div>
              </div>

              {/* Priority, due date and the action travel together: on a phone
                  they wrap onto their own line instead of squeezing the title. */}
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                <PriorityBadge priority={task.priority} />

                <p
                  className={`text-xs font-semibold sm:w-28 sm:text-right ${
                    task.isOverdue ? 'text-danger-500' : 'text-[var(--color-text-muted)]'
                  }`}
                  title={formatDateTime(task.dueAt)}
                >
                  {formatRelative(task.dueAt)}
                </p>

                {task.entityType === 'LEAD' && task.entityId ? (
                  <Link
                    href={`/leads/${task.entityId}`}
                    className="btn btn-outline ml-auto h-8 shrink-0 text-xs sm:ml-0"
                  >
                    Open lead
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterLink({ href, label, active }: { href: Route; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`h-9 rounded-lg border px-3 text-xs font-semibold leading-9 transition-colors ${
        active
          ? 'border-navy-500 bg-navy-500 text-white'
          : 'border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]'
      }`}
    >
      {label}
    </Link>
  );
}
