import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import type { UserSummary } from '@sihl-one/contracts';

import { Icon } from '@/components/shell/Icon';
import { UserDirectory } from '@/components/admin/UserDirectory';
import { apiFetch } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';
export const metadata = { title: 'Users' };


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
            You see your own branch and everything below it. Sorted most senior first
            until you choose a column.
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

      <UserDirectory users={users} canUpdate={can(user, 'user:update')} actorId={user.id} />
    </div>
  );
}
