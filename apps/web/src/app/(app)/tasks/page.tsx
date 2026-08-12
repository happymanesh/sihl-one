import Link from 'next/link';
import type { Route } from 'next';

import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/shell/Icon';
import { PriorityBadge } from '@/components/ui/Badge';
import { StatTile } from '@/components/ui/StatTile';
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
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireUser();
  const params = await searchParams;

  const [summary, data] = await Promise.all([
    apiFetch<{ open: number; overdue: number; dueToday: number; completedThisWeek: number }>(
      '/tasks/summary',
    ),
    apiFetch<{ items: TaskRow[]; total: number }>(
      `/tasks${toQuery({
        status: params.status ?? 'OPEN',
        overdueOnly: params.overdueOnly,
        pageSize: '50',
      })}`,
    ),
  ]);

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
        <ul className="space-y-2">
          {data.items.map((task) => (
            <li key={task.id} className="card flex flex-wrap items-center gap-3 p-3.5">
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${
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
                {task.description ? (
                  <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">
                    {task.description}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
                  <span className="font-mono">{task.reference}</span>
                  {task.assignee ? ` · ${task.assignee.fullName}` : ''}
                </p>
              </div>

              <PriorityBadge priority={task.priority} />

              <div className="w-32 shrink-0 text-right">
                <p
                  className={`text-xs font-semibold ${
                    task.isOverdue ? 'text-danger-500' : 'text-[var(--color-text-muted)]'
                  }`}
                  title={formatDateTime(task.dueAt)}
                >
                  {formatRelative(task.dueAt)}
                </p>
              </div>

              {task.entityType === 'LEAD' && task.entityId ? (
                <Link href={`/leads/${task.entityId}`} className="btn btn-outline h-8 text-xs">
                  Open lead
                </Link>
              ) : null}
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
