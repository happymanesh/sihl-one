import Link from 'next/link';
import { redirect } from 'next/navigation';

import { TrainingForm } from '@/components/training/TrainingForm';
import { apiFetch } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';

import { toBranchOptions, type OrgUnitNode } from '@/components/training/branches';

export const metadata = { title: 'Schedule training' };

export default async function NewTrainingPage() {
  const user = await requireUser();
  if (!can(user, 'training:manage')) redirect('/training');

  const [units, presenters] = await Promise.all([
    apiFetch<OrgUnitNode[]>('/org-units').catch(() => [] as OrgUnitNode[]),
    // The lighter directory, not the owner picker: naming who presents is a
    // much wider question than deciding who a client may be handed to.
    apiFetch<Array<{ id: string; fullName: string; employeeCode?: string | null }>>(
      '/users/colleagues',
    ).catch(() => []),
  ]);

  const branches = toBranchOptions(units);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <Link
          href="/training"
          className="text-xs font-semibold text-[var(--color-text-muted)] hover:underline"
        >
          ← All training
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-bold">Schedule a training session</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          It appears for every branch you pick. You can attach the deck after saving, and edit
          anything up until the session has run.
        </p>
      </header>

      <TrainingForm branches={branches} presenters={presenters} />
    </div>
  );
}
