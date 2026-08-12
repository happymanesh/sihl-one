import Link from 'next/link';
import type { Route } from 'next';

import { Badge } from '@/components/ui/Badge';
import { CheckInPanel, CheckOutPanel } from '@/components/visits/CheckInPanel';
import { apiFetch } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { formatDateTime, humanise } from '@/lib/format';

interface VisitDetail {
  id: string;
  reference: string;
  status: string;
  purpose: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
  user: { id: string; fullName: string; email: string } | null;
  plannedAt: string | null;
  checkIn: {
    at: string;
    latitude: number | null;
    longitude: number | null;
    accuracy: number | null;
    quality: string;
    address: string | null;
    photoUrl: string | null;
  } | null;
  checkOut: {
    at: string;
    latitude: number | null;
    longitude: number | null;
    accuracy: number | null;
    quality: string;
  } | null;
  durationMinutes: number | null;
  meetingNotes: string | null;
  outcome: string | null;
  nextFollowUpAt: string | null;
  integrity: { driftMetres: number | null; requiresReview: boolean; reasons: string[] };
  createdAt: string;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const visit = await apiFetch<VisitDetail>(`/visits/${id}`);
    return { title: `Visit ${visit.reference}` };
  } catch {
    return { title: 'Visit' };
  }
}

export default async function VisitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const visit = await apiFetch<VisitDetail>(`/visits/${id}`);
  // Only the person making the visit may act on it — a check-in asserts that a
  // specific person was somewhere, so nobody can record it on their behalf.
  const isOwner = visit.user?.id === user.id;

  const parentHref =
    visit.entityType === 'LEAD' ? `/leads/${visit.entityId}` : `/customers/${visit.entityId}`;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <nav className="text-xs text-[var(--color-text-muted)]">
        <Link href="/visits" className="hover:underline">
          Visits
        </Link>
        <span className="mx-1.5" aria-hidden>
          /
        </span>
        <span className="font-mono">{visit.reference}</span>
      </nav>

      <header className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold">{visit.entityName ?? 'Visit'}</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">{visit.purpose}</p>
            <Link
              href={parentHref as Route}
              className="mt-2 inline-block text-xs font-semibold text-teal-600 hover:underline dark:text-teal-300"
            >
              Open {visit.entityType.toLowerCase()} record →
            </Link>
          </div>
          <Badge
            tone={
              visit.status === 'COMPLETED'
                ? 'green'
                : visit.status === 'CHECKED_IN'
                  ? 'amber'
                  : visit.status === 'CANCELLED' || visit.status === 'MISSED'
                    ? 'neutral'
                    : 'blue'
            }
          >
            {humanise(visit.status)}
          </Badge>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-[var(--color-text-muted)]">Relationship manager</dt>
            <dd className="font-medium">{visit.user?.fullName ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--color-text-muted)]">Planned for</dt>
            <dd className="font-medium">
              {visit.plannedAt ? formatDateTime(visit.plannedAt) : 'No time set'}
            </dd>
          </div>
        </dl>
      </header>

      {visit.integrity.requiresReview ? (
        <section className="card border-l-[4px] border-l-warn-500 p-4">
          <h2 className="text-sm font-bold">Needs review</h2>
          <ul className="mt-1.5 space-y-1 text-sm text-[var(--color-text-muted)]">
            {visit.integrity.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--color-text-subtle)]">
            These are observations about the location evidence, not an accusation. The visit is
            recorded either way.
          </p>
        </section>
      ) : null}

      {visit.status === 'PLANNED' && isOwner ? (
        <section className="card p-5">
          <h2 className="font-bold">Check in</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
            Records one location reading and a photo. Nothing is tracked between check-in and
            check-out.
          </p>
          <div className="mt-4">
            <CheckInPanel visitId={visit.id} />
          </div>
        </section>
      ) : null}

      {visit.status === 'CHECKED_IN' && isOwner ? (
        <section className="card p-5">
          <h2 className="font-bold">Check out</h2>
          <div className="mt-4">
            <CheckOutPanel visitId={visit.id} />
          </div>
        </section>
      ) : null}

      {visit.status === 'PLANNED' && !isOwner ? (
        <p className="card p-4 text-sm text-[var(--color-text-muted)]">
          Only {visit.user?.fullName ?? 'the assigned RM'} can check in to this visit.
        </p>
      ) : null}

      {visit.checkIn ? (
        <section className="card p-5">
          <h2 className="font-bold">Location evidence</h2>

          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                Check-in
              </h3>
              <p className="mt-1 text-sm font-medium">{formatDateTime(visit.checkIn.at)}</p>
              <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">
                {visit.checkIn.latitude?.toFixed(5)}, {visit.checkIn.longitude?.toFixed(5)}
              </p>
              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                {humanise(visit.checkIn.quality)} · ±{visit.checkIn.accuracy} m
              </p>
              {visit.checkIn.address ? (
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  {visit.checkIn.address}
                </p>
              ) : null}
            </div>

            {visit.checkOut ? (
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                  Check-out
                </h3>
                <p className="mt-1 text-sm font-medium">{formatDateTime(visit.checkOut.at)}</p>
                <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">
                  {visit.checkOut.latitude?.toFixed(5)}, {visit.checkOut.longitude?.toFixed(5)}
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                  {humanise(visit.checkOut.quality)} · ±{visit.checkOut.accuracy} m
                </p>
              </div>
            ) : null}
          </div>

          {visit.checkIn.photoUrl ? (
            <div className="mt-4">
              <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
                Check-in photo
              </h3>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/visit-photo?visitId=${visit.id}&token=${encodeURIComponent(
                  // The API returns the signed grant embedded in a URL; only the
                  // token itself is forwarded, never a caller-controlled path.
                  new URLSearchParams(visit.checkIn.photoUrl.split('?')[1] ?? '').get('token') ?? '',
                )}`}
                alt="Check-in photo"
                className="mt-1.5 h-48 w-full rounded-lg object-cover"
              />
            </div>
          ) : null}

          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-[var(--color-text-muted)]">Duration</dt>
              <dd className="font-medium">
                {visit.durationMinutes === null ? '—' : `${visit.durationMinutes} min`}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-text-muted)]">Distance between readings</dt>
              <dd className="font-medium">
                {visit.integrity.driftMetres === null ? '—' : `${visit.integrity.driftMetres} m`}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      {visit.meetingNotes && visit.status === 'COMPLETED' ? (
        <section className="card p-5">
          <h2 className="font-bold">Meeting notes</h2>
          <p className="mt-2 whitespace-pre-line text-sm">{visit.meetingNotes}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-[var(--color-text-muted)]">Outcome</dt>
              <dd className="font-medium">{visit.outcome ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--color-text-muted)]">Next follow-up</dt>
              <dd className="font-medium">
                {visit.nextFollowUpAt ? formatDateTime(visit.nextFollowUpAt) : '—'}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}
    </div>
  );
}
