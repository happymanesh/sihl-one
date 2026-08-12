import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import type { UserSummary } from '@sihl-one/contracts';

import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/shell/Icon';
import { apiFetch } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';
import { humanise } from '@/lib/format';

export const metadata = { title: 'Users' };

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'neutral'> = {
  ACTIVE: 'green',
  INVITED: 'amber',
  SUSPENDED: 'red',
  LOCKED: 'red',
  DISABLED: 'neutral',
};

export default async function UsersPage() {
  const user = await requireUser();
  if (!can(user, 'user:read')) redirect('/dashboard');

  const users = await apiFetch<UserSummary[]>('/admin/users').catch(() => [] as UserSummary[]);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Most senior first. You see your own branch and everything below it.
          </p>
        </div>
        <div className="flex gap-2">
          {can(user, 'system:configure') ? (
            <Link href={'/admin/designations' as Route} className="btn btn-outline">
              Hierarchy levels
            </Link>
          ) : null}
          {can(user, 'user:create') ? (
            <Link href={'/admin/users/new' as Route} className="btn btn-primary">
              <Icon name="plus" size={16} />
              Add user
            </Link>
          ) : null}
        </div>
      </header>

      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] text-left">
              <tr>
                {['Name', 'Designation', 'Reports to', 'Branch', 'Roles', 'Status', ''].map(
                  (heading) => (
                    <th
                      key={heading}
                      className="px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]"
                    >
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {users.map((person) => (
                <tr key={person.id} className="hover:bg-[var(--color-surface-muted)]">
                  <td className="px-4 py-3">
                    <p className="font-semibold">{person.fullName}</p>
                    <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
                      {person.email}
                      {person.employeeCode ? ` · ${person.employeeCode}` : ''}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {person.designation ? (
                      <>
                        <span className="font-semibold">{person.designation.name}</span>
                        <span className="ml-1 text-[var(--color-text-subtle)]">
                          L{person.designation.level}
                        </span>
                      </>
                    ) : (
                      <span className="text-[var(--color-text-subtle)]">Non-sales</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {person.manager?.fullName ?? (
                      <span className="text-[var(--color-text-subtle)]">—</span>
                    )}
                    {person.directReports > 0 ? (
                      <span className="ml-1 text-[var(--color-text-subtle)]">
                        ({person.directReports} report{person.directReports === 1 ? '' : 's'})
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-xs">{person.orgUnit?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {person.roles.map((role) => (
                        <Badge key={role} tone="navy">
                          {role.replace(/_/g, ' ')}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[person.status] ?? 'neutral'}>
                      {humanise(person.status)}
                    </Badge>
                    {/* An invited account has no password at all, so it is not
                        merely inactive — nobody can sign in until credentials
                        are issued. Saying so here prevents a support call. */}
                    {person.status === 'INVITED' ? (
                      <p className="mt-1 text-[0.6875rem] text-warn-600">Cannot sign in yet</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {can(user, 'user:update') && person.id !== user.id ? (
                      <Link
                        href={`/admin/users/${person.id}` as Route}
                        className="btn btn-outline h-8 text-xs"
                      >
                        Manage
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {users.length === 0 ? (
        <p className="card p-6 text-center text-sm text-[var(--color-text-muted)]">
          No users visible in your part of the organisation.
        </p>
      ) : null}
    </div>
  );
}
