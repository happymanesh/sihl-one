import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { TrainingView } from '@sihl-one/contracts';

import { Badge } from '@/components/ui/Badge';
import { MaterialUploader } from '@/components/training/MaterialUploader';
import { TrainingActions } from '@/components/training/TrainingActions';
import { TrainingForm } from '@/components/training/TrainingForm';
import { toBranchOptions, type OrgUnitNode } from '@/components/training/branches';
import { ApiError, apiFetch } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';
import { formatDateTime, formatNumber, formatTime } from '@/lib/format';

export const metadata = { title: 'Training session' };

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function TrainingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  let session: TrainingView;
  try {
    session = await apiFetch<TrainingView>(`/training/${id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const canManage = can(user, 'training:manage');
  // `editable` is the server's answer, computed against its own clock, so a
  // browser with a wrong clock cannot show an Edit form the API would refuse.
  const canEdit = canManage && session.editable;

  const [units, presenters] = canEdit
    ? await Promise.all([
        apiFetch<OrgUnitNode[]>('/org-units').catch(() => [] as OrgUnitNode[]),
        apiFetch<Array<{ id: string; fullName: string; employeeCode?: string | null }>>(
          '/users/colleagues',
        ).catch(() => []),
      ])
    : [[] as OrgUnitNode[], [] as Array<{ id: string; fullName: string }>];

  const branches = toBranchOptions(units);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link
          href="/training"
          className="text-xs font-semibold text-[var(--color-text-muted)] hover:underline"
        >
          ← All training
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{session.topic}</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {formatDateTime(session.startsAt)} – {formatTime(session.endsAt)} ·{' '}
            {session.durationMinutes} min
            {session.presenterName ? ` · ${session.presenterName}` : ''}
          </p>
        </div>
        {session.status === 'CANCELLED' ? (
          <Badge tone="neutral">Cancelled</Badge>
        ) : session.editable ? (
          <Badge tone="navy">Scheduled</Badge>
        ) : (
          <Badge tone="teal">Done</Badge>
        )}
      </header>

      {/*
        Say why it is read-only, rather than just withholding the form.

        A manager who can edit one session and not another, with no explanation,
        reads that as a permission bug and asks for access they already have.
      */}
      {canManage && !session.editable ? (
        <p className="card bg-[var(--color-surface-muted)] p-3 text-sm text-[var(--color-text-muted)]">
          {session.status === 'CANCELLED'
            ? 'This session was cancelled. It is kept as a record and cannot be changed.'
            : `This session finished at ${formatTime(session.endsAt)} and is now a record rather than a plan, so it can no longer be edited. The material stays available below.`}
        </p>
      ) : null}

      <section className="card space-y-3 p-5">
        <h2 className="text-sm font-bold">Who it is for</h2>
        <div className="flex flex-wrap gap-1.5">
          {session.branches.map((branch) => (
            <span
              key={branch.id}
              className="rounded-full border border-[var(--color-border)] px-2.5 py-0.5 text-xs text-[var(--color-text-muted)]"
            >
              {branch.name}
            </span>
          ))}
        </div>

        {session.remarks ? (
          <div>
            <h3 className="label">Remarks</h3>
            <p className="whitespace-pre-wrap text-sm text-[var(--color-text-muted)]">
              {session.remarks}
            </p>
          </div>
        ) : null}

        <p className="text-xs text-[var(--color-text-subtle)]">
          Scheduled by {session.createdBy} on {formatDateTime(session.createdAt)}
        </p>
      </section>

      <section className="card space-y-3 p-5">
        <h2 className="text-sm font-bold">
          Material{' '}
          {session.material.length > 0 ? (
            <span className="font-normal text-[var(--color-text-subtle)]">
              ({formatNumber(session.material.length)})
            </span>
          ) : null}
        </h2>

        {session.material.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">Nothing attached yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)]">
            {session.material.map((file) => (
              <li key={file.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  {/*
                    A plain link, not a fetch-and-blob: the proxy sends the
                    original filename back in Content-Disposition, so the file
                    lands on disk called what it was called here.
                  */}
                  <a
                    href={`/api/training/${session.id}/material/${file.id}`}
                    className="block truncate text-sm font-semibold hover:text-teal-600 hover:underline dark:hover:text-teal-300"
                  >
                    {file.fileName}
                  </a>
                  <p className="text-xs text-[var(--color-text-subtle)]">
                    {fileSize(file.sizeBytes)} · {file.uploadedBy} ·{' '}
                    {formatDateTime(file.createdAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        {canEdit ? <MaterialUploader trainingId={session.id} /> : null}
      </section>

      {canEdit ? (
        <section className="space-y-3">
          <h2 className="text-sm font-bold">Edit</h2>
          <TrainingForm branches={branches} presenters={presenters} training={session} />
          <TrainingActions trainingId={session.id} />
        </section>
      ) : null}
    </div>
  );
}
