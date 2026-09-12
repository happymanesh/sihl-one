'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import {
  ATTENDEE_ROLES,
  ATTENDEE_ROLE_LABELS,
  type AttendeeRole,
  type AttendeeView,
} from '@sihl-one/contracts';

import {
  addVisitAttendee,
  confirmVisitAttendance,
  removeVisitAttendee,
  type VisitActionState,
} from '@/app/actions/visits';
import { formatDateTime } from '@/lib/format';

const INITIAL: VisitActionState = { status: 'idle' };

/**
 * Who else is on this visit.
 *
 * Shows the expected list while the visit is open, and at check-out asks which
 * of them actually came. The two states are the same list read twice, which is
 * why they share a component: a manager later wants to compare what was planned
 * with what happened, and that comparison only exists if both were recorded
 * against the same rows.
 */
export function AttendeePanel({
  visitId,
  status,
  attendees,
  colleagues,
}: {
  visitId: string;
  status: string;
  attendees: AttendeeView[];
  /** People the viewer may pick, from `/users/assignable`. */
  colleagues: Array<{ id: string; fullName: string; employeeCode?: string | null }>;
}) {
  const closed = status === 'COMPLETED' || status === 'CANCELLED';
  const confirming = status === 'CHECKED_IN';

  const [addState, add] = useActionState(addVisitAttendee, INITIAL);
  const [removeState, remove] = useActionState(removeVisitAttendee, INITIAL);
  const [confirmState, confirm] = useActionState(confirmVisitAttendance, INITIAL);

  const alreadyOn = new Set(attendees.map((row) => row.userId));
  const pickable = colleagues.filter((person) => !alreadyOn.has(person.id));

  const feedback = [addState, removeState, confirmState].find(
    (state) => state.status !== 'idle',
  );

  return (
    <section className="card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-bold">Who else is going</h2>
        <span className="text-xs text-[var(--color-text-subtle)]">
          {attendees.length === 0
            ? 'Just you'
            : `${attendees.length} colleague${attendees.length === 1 ? '' : 's'}`}
        </span>
      </div>

      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
        The visit stays yours. This records who supported it.
      </p>

      {attendees.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {attendees.map((person) => (
            <li
              key={person.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
            >
              <span className="font-medium">{person.fullName}</span>
              <span className="rounded-full bg-[var(--color-surface-inset)] px-2 py-0.5 text-[0.6875rem] font-semibold text-[var(--color-text-muted)]">
                {ATTENDEE_ROLE_LABELS[person.role] ?? person.role}
              </span>
              {person.confirmedAt ? (
                <span className="text-xs font-semibold text-teal-600 dark:text-teal-400">
                  Came · {formatDateTime(person.confirmedAt)}
                </span>
              ) : closed ? (
                // Said plainly rather than left blank. On a finished visit an
                // unconfirmed row is a fact — the expert did not come — and a
                // silent gap reads as missing data instead.
                <span className="text-xs text-[var(--color-text-subtle)]">Did not attend</span>
              ) : (
                <span className="text-xs text-[var(--color-text-subtle)]">Expected</span>
              )}

              {!closed ? (
                <form action={remove} className="ml-auto">
                  <input type="hidden" name="visitId" value={visitId} />
                  <input type="hidden" name="attendeeId" value={person.id} />
                  <RemoveButton />
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {confirming && attendees.length > 0 ? (
        <form action={confirm} className="mt-4 rounded-lg bg-[var(--color-surface-muted)] p-3">
          <input type="hidden" name="visitId" value={visitId} />
          <p className="text-sm font-semibold">Who actually came?</p>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            Leave anyone who did not turn up unticked — that is worth recording too.
          </p>
          <div className="mt-2 space-y-1.5">
            {attendees.map((person) => (
              <label key={person.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="presentUserIds"
                  value={person.userId}
                  defaultChecked={Boolean(person.confirmedAt)}
                  className="h-4 w-4 accent-[var(--color-teal-500)]"
                />
                {person.fullName}
              </label>
            ))}
          </div>
          <SubmitButton label="Record attendance" pending="Recording…" />
        </form>
      ) : null}

      {!closed ? (
        <form action={add} className="mt-4 flex flex-wrap items-end gap-2">
          <input type="hidden" name="visitId" value={visitId} />
          <div className="min-w-[12rem] flex-1">
            <label className="label" htmlFor="attendee-user">
              Bring a colleague
            </label>
            <select id="attendee-user" name="userId" className="input h-9" defaultValue="">
              <option value="">Choose someone…</option>
              {pickable.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                  {person.employeeCode ? ` · ${person.employeeCode}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="attendee-role">
              As
            </label>
            <select id="attendee-role" name="role" className="input h-9 w-auto" defaultValue="SUPPORT">
              {ATTENDEE_ROLES.map((role: AttendeeRole) => (
                <option key={role} value={role}>
                  {ATTENDEE_ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </div>
          <SubmitButton label="Add" pending="Adding…" small />
        </form>
      ) : null}

      {feedback && feedback.status !== 'idle' ? (
        <p
          className={`mt-2 text-xs font-medium ${
            feedback.status === 'error'
              ? 'text-danger-500'
              : 'text-teal-600 dark:text-teal-400'
          }`}
          role="status"
        >
          {feedback.message}
        </p>
      ) : null}
    </section>
  );
}

function SubmitButton({
  label,
  pending: pendingLabel,
  small,
}: {
  label: string;
  pending: string;
  small?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`btn-primary ${small ? 'h-9 px-3 text-xs' : 'mt-3 px-4 py-2 text-sm'} disabled:opacity-60`}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

function RemoveButton() {
  const { pending } = useFormStatus();
  const [confirmed, setConfirmed] = useState(false);

  // Two taps, because this sits next to a name on a phone and a stray thumb
  // should not quietly drop somebody off a meeting.
  if (!confirmed) {
    return (
      <button
        type="button"
        onClick={() => setConfirmed(true)}
        className="text-xs font-semibold text-[var(--color-text-muted)] underline underline-offset-2"
      >
        Remove
      </button>
    );
  }
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-xs font-semibold text-danger-500 underline underline-offset-2 disabled:opacity-60"
    >
      {pending ? 'Removing…' : 'Tap again to confirm'}
    </button>
  );
}
