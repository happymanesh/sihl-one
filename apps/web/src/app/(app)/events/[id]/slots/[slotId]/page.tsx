import Link from 'next/link';
import type { Route } from 'next';
import { notFound } from 'next/navigation';
import type { EventDetail, PresentationAttendee, PresentationDay } from '@sihl-one/contracts';

import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/shell/Icon';
import { apiFetch } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';
import { formatDateTime, formatNumber, formatTime } from '@/lib/format';

export const metadata = { title: 'Who booked' };

interface Props {
  params: Promise<{ id: string; slotId: string }>;
}

/**
 * Who booked one talk.
 *
 * Its own page rather than a panel on the event screen: the list is what
 * somebody running the talk walks in holding, and a page can be opened on a
 * phone, kept open, and printed. The way back is a button, because this is a
 * detour from the event and the reader will make the trip repeatedly.
 */
export default async function SlotAttendeesPage({ params }: Props) {
  const { id, slotId } = await params;
  const user = await requireUser();

  const [event, schedule, attendees] = await Promise.all([
    apiFetch<EventDetail>(`/events/${id}`),
    apiFetch<PresentationDay[]>(`/presentations/events/${id}/slots`).catch(
      () => [] as PresentationDay[],
    ),
    apiFetch<PresentationAttendee[]>(`/presentations/slots/${slotId}/attendees`).catch(
      () => [] as PresentationAttendee[],
    ),
  ]);

  // The slot's own details come from the schedule rather than a second
  // endpoint. It is already loaded, and one source means the heading here and
  // the row on the event page can never disagree.
  const slot = schedule.flatMap((day) => day.slots).find((entry) => entry.id === slotId);
  if (!slot) notFound();

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold">{slot.topic}</h1>
            {!slot.isActive ? (
              <span className="rounded-md bg-danger-600/10 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-danger-600 dark:text-danger-500">
                Cancelled
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {formatDateTime(slot.startsAt)} · {slot.durationMinutes} min
            {slot.presenterName ? ` · ${slot.presenterName}` : ''} ·{' '}
            {formatNumber(attendees.length)} registered
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/events/${id}` as Route} className="btn btn-outline">
            ← Back to {event.name}
          </Link>
          {/*
            The export carries unmasked numbers, so it is a separate grant from
            reading the list — the same line the leads export draws.
          */}
          {can(user, 'lead:export') && attendees.length > 0 ? (
            <a
              href={`/api/presentations/slots/${slotId}/export`}
              className="btn btn-outline"
              download
            >
              <Icon name="file" size={16} />
              Export CSV
            </a>
          ) : null}
        </div>
      </header>

      {!slot.isActive ? (
        <p className="rounded-lg border border-warn-500/40 bg-warn-50 px-3 py-2 text-sm text-warn-600 dark:bg-warn-500/15">
          {/* The whole point of keeping bookings on a cancelled talk is that
              somebody rings these people. Said here, where the list is. */}
          This talk was cancelled. These people still think they are coming — somebody needs to tell
          them.
        </p>
      ) : null}

      {attendees.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Icon name="users" size={40} />}
            title="Nobody has booked yet"
            description="Seats appear here as visitors book them at the stall."
            action={
              <Link href={`/events/${id}` as Route} className="btn btn-outline">
                Back to the event
              </Link>
            }
          />
        </div>
      ) : (
        <>
          {/* Desktop */}
          <div className="card hidden overflow-hidden p-0 md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] text-left">
                  <tr>
                    <Th>Visitor</Th>
                    <Th>Mobile</Th>
                    <Th>Email</Th>
                    <Th>Booked</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {attendees.map((person) => (
                    <tr
                      key={person.leadId}
                      className="transition-colors hover:bg-[var(--color-surface-muted)]"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/leads/${person.leadId}` as Route}
                          className="font-semibold hover:text-teal-600 hover:underline dark:hover:text-teal-300"
                        >
                          {person.fullName}
                        </Link>
                        <div className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">
                          {person.reference}
                        </div>
                      </td>
                      {/* Masked, as everywhere a list of people is shown. The
                          export is where full numbers live. */}
                      <td className="px-4 py-3 tnum">{person.mobileMasked}</td>
                      <td className="px-4 py-3">
                        {person.email ?? <span className="text-[var(--color-text-subtle)]">—</span>}
                      </td>
                      <td className="px-4 py-3 text-[var(--color-text-muted)]">
                        {formatTime(person.bookedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile */}
          <ul className="space-y-2.5 md:hidden">
            {attendees.map((person) => (
              <li key={person.leadId}>
                <Link href={`/leads/${person.leadId}` as Route} className="card block p-4">
                  <p className="font-bold">{person.fullName}</p>
                  <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">
                    {person.reference} · {person.mobileMasked}
                  </p>
                  {person.email ? (
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">{person.email}</p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]"
    >
      {children}
    </th>
  );
}
