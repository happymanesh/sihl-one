import Link from 'next/link';
import type { Route } from 'next';
import { redirect } from 'next/navigation';
import type { DesignationSummary, UserSummary } from '@sihl-one/contracts';

import { Badge } from '@/components/ui/Badge';
import { CredentialsPanel } from '@/components/admin/CredentialsPanel';
import { UserForm } from '@/components/admin/UserForm';
import { apiFetch } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';
import { grantableRolesFor, orgUnitOptions } from '@/lib/admin';
import { humanise } from '@/lib/format';

export const metadata = { title: 'Manage user' };

export default async function ManageUserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const actor = await requireUser();
  if (!can(actor, 'user:update')) redirect('/admin/users');

  const { id } = await params;
  const { created } = await searchParams;

  // Editing yourself through this screen would let someone change their own
  // designation or roles, which is the escalation the guards exist to stop.
  if (id === actor.id) redirect('/admin/users');

  const [users, designations, orgUnits] = await Promise.all([
    apiFetch<UserSummary[]>('/admin/users'),
    apiFetch<DesignationSummary[]>('/admin/designations').catch(() => [] as DesignationSummary[]),
    orgUnitOptions(),
  ]);

  const person = users.find((candidate) => candidate.id === id);
  if (!person) redirect('/admin/users');

  const [firstName = '', ...rest] = person.fullName.split(' ');

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <nav className="text-xs text-[var(--color-text-muted)]">
        <Link href="/admin/users" className="hover:underline">
          Users
        </Link>
        <span className="mx-1.5" aria-hidden>
          /
        </span>
        <span>{person.fullName}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold">{person.fullName}</h1>
            <Badge
              tone={
                person.status === 'ACTIVE' ? 'green' : person.status === 'INVITED' ? 'amber' : 'red'
              }
            >
              {humanise(person.status)}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {person.email}
            {person.employeeCode ? ` · ${person.employeeCode}` : ''} ·{' '}
            {person.designation?.name ?? 'Non-sales'} · sees {humanise(person.dataScope)}
          </p>
        </div>
        <Link
          href={`/admin/users/${id}/offboard` as Route}
          className="btn btn-outline"
        >
          Offboard
        </Link>
      </header>

      {created ? (
        <div
          role="status"
          className="rounded-lg border border-teal-500/40 bg-teal-50 px-4 py-3 text-sm dark:bg-teal-900/30"
        >
          <strong>User created.</strong> They cannot sign in yet — issue credentials below.
        </div>
      ) : null}

      {person.isHrManaged ? (
        <div className="card border-l-[4px] border-l-warn-500 p-4 text-sm">
          <span className="font-semibold">Managed by HR.</span> Changes here may be overwritten by
          the next HR sync.
        </div>
      ) : null}

      <CredentialsPanel userId={id} email={person.email} status={person.status} />

      <section className="card p-5">
        <h2 className="font-bold">Details and access</h2>
        <div className="mt-4">
          <UserForm
            mode="edit"
            values={{
              id,
              firstName,
              lastName: rest.join(' '),
              email: person.email,
              employeeCode: person.employeeCode,
              designationId: person.designation?.id ?? null,
              orgUnitId: person.orgUnit?.id ?? null,
              managerId: person.manager?.id ?? null,
              roleCodes: person.roles,
              status: person.status,
            }}
            designations={designations}
            orgUnits={orgUnits}
            grantableRoles={grantableRolesFor(actor)}
          />
        </div>
      </section>
    </div>
  );
}
