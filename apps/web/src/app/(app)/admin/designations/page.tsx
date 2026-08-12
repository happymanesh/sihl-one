import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { DesignationSummary } from '@sihl-one/contracts';

import { DesignationManager } from '@/components/admin/DesignationManager';
import { apiFetch } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';

export const metadata = { title: 'Hierarchy levels' };

export default async function DesignationsPage() {
  const user = await requireUser();
  if (!can(user, 'system:configure')) redirect('/admin/users');

  const designations = await apiFetch<DesignationSummary[]>(
    '/admin/designations?includeInactive=true',
  ).catch(() => [] as DesignationSummary[]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <nav className="text-xs text-[var(--color-text-muted)]">
        <Link href="/admin/users" className="hover:underline">
          Users
        </Link>
        <span className="mx-1.5" aria-hidden>
          /
        </span>
        <span>Hierarchy levels</span>
      </nav>

      <header>
        <h1 className="text-2xl font-bold">Hierarchy levels</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          These are data, not code — you can add a level or switch one on without a release.
          Levels may be skipped, so a Sales Manager can report straight to a Zonal Head where no
          Regional Head exists.
        </p>
      </header>

      <DesignationManager designations={designations} />
    </div>
  );
}
