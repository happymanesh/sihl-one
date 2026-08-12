import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { OffboardPreview } from '@sihl-one/contracts';

import { OffboardPanel } from '@/components/admin/OffboardPanel';
import { apiFetch } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';

export const metadata = { title: 'Offboard user' };

interface AssignableUser {
  id: string;
  fullName: string;
}

export default async function OffboardPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireUser();
  if (!can(actor, 'user:update')) redirect('/dashboard');

  const { id } = await params;
  if (id === actor.id) redirect('/admin/users');

  const [preview, candidates] = await Promise.all([
    apiFetch<OffboardPreview>(`/users/${id}/offboard/preview`),
    apiFetch<AssignableUser[]>('/users/assignable').catch(() => [] as AssignableUser[]),
  ]);

  const alreadyOffboarded = preview.user.status === 'DISABLED';

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <nav className="text-xs text-[var(--color-text-muted)]">
        <Link href="/admin/users" className="hover:underline">
          Users
        </Link>
        <span className="mx-1.5" aria-hidden>
          /
        </span>
        <span>{preview.user.fullName}</span>
      </nav>

      <header>
        <h1 className="text-2xl font-bold">{preview.user.fullName}</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {preview.user.email} · {preview.holdings.activeSessions} active session
          {preview.holdings.activeSessions === 1 ? '' : 's'}
        </p>
      </header>

      {alreadyOffboarded ? (
        <div className="card p-5">
          <h2 className="font-bold">Already offboarded</h2>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            This account is disabled. Any remaining records still attributed to them are closed
            work, which stays put by design.
          </p>
        </div>
      ) : (
        <OffboardPanel
          userId={id}
          fullName={preview.user.fullName}
          holdings={preview.holdings}
          recipients={candidates.filter((person) => person.id !== id)}
          inNotice={false}
        />
      )}
    </div>
  );
}
