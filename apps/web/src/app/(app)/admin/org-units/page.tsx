import { redirect } from 'next/navigation';
import type { OrgUnitNode } from '@sihl-one/contracts';

import { OrgTree } from '@/components/org/OrgTree';
import { apiFetch } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';

export const metadata = { title: 'Branches and regions' };

export default async function OrgUnitsPage() {
  const user = await requireUser();
  if (!can(user, 'system:configure')) redirect('/dashboard');

  const units = await apiFetch<OrgUnitNode[]>('/org-units');

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold">Branches and regions</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          This tree decides who sees whose records. A branch manager sees their branch; a
          regional head sees the branches under their region. Moving a unit changes that
          immediately, for everyone in it.
        </p>
      </header>

      <OrgTree units={units} />
    </div>
  );
}
