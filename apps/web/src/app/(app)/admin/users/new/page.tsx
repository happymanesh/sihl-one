import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { DesignationSummary } from '@sihl-one/contracts';

import { UserForm } from '@/components/admin/UserForm';
import { apiFetch } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';
import { grantableRolesFor, orgUnitOptions } from '@/lib/admin';

export const metadata = { title: 'Add user' };

export default async function NewUserPage() {
  const user = await requireUser();
  if (!can(user, 'user:create')) redirect('/admin/users');

  const [designations, orgUnits] = await Promise.all([
    apiFetch<DesignationSummary[]>('/admin/designations').catch(
      () => [] as DesignationSummary[],
    ),
    orgUnitOptions(),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <nav className="text-xs text-[var(--color-text-muted)]">
        <Link href="/admin/users" className="hover:underline">
          Users
        </Link>
        <span className="mx-1.5" aria-hidden>
          /
        </span>
        <span>Add</span>
      </nav>

      <header>
        <h1 className="text-2xl font-bold">Add a user</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          You can only create people below your own designation, inside your own branch or below
          it, and with roles you hold yourself.
        </p>
      </header>

      <div className="card p-5">
        <UserForm
          mode="create"
          designations={designations}
          orgUnits={orgUnits}
          grantableRoles={grantableRolesFor(user)}
        />
      </div>
    </div>
  );
}
