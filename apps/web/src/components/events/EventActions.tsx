'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { EventStatus } from '@sihl-one/contracts';

import { changeEventStatus, type EventFormState } from '@/app/actions/events';
import { humanise } from '@/lib/format';

const INITIAL: EventFormState = { status: 'idle' };

/**
 * Opening and closing an event for scans.
 *
 * Inline rather than behind a menu: on the morning of an event somebody is
 * standing at a desk with a phone, and "start accepting scans" is the only
 * thing they need. Burying it costs them the first ten registrations.
 */
export function EventActions({
  eventId,
  status,
  allowedTransitions,
}: {
  eventId: string;
  status: EventStatus;
  allowedTransitions: EventStatus[];
}) {
  const [state, action] = useActionState(changeEventStatus, INITIAL);

  if (allowedTransitions.length === 0) {
    return (
      <p className="text-xs text-[var(--color-text-muted)]">
        {humanise(status)} — this event is closed for good.
      </p>
    );
  }

  return (
    <div className="text-right">
      {state.status === 'error' && state.message ? (
        <p role="alert" className="mb-1.5 text-xs text-danger-500">
          {state.message}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        {allowedTransitions.map((next) => (
          <TransitionForm key={next} eventId={eventId} next={next} action={action} />
        ))}
      </div>
    </div>
  );
}

/** Closing or cancelling cannot be undone, so neither happens on one tap. */
function isFinal(next: EventStatus): boolean {
  return next === 'COMPLETED' || next === 'CANCELLED';
}

// Verbs, not statuses. "Cancelled" on a button reads as a label, not as
// something that happens when you press it.
function labelFor(next: EventStatus): string {
  return next === 'RUNNING'
    ? 'Start accepting scans'
    : next === 'COMPLETED'
      ? 'Close event'
      : next === 'CANCELLED'
        ? 'Cancel event'
        : humanise(next);
}

/**
 * One transition, and for the irreversible ones a question first.
 *
 * Closing an event stops every QR on the floor from accepting a scan, and the
 * status has no way back — `EVENT_STATUS_TRANSITIONS` leaves a closed event
 * with nowhere to go. It sat one careless tap from Refresh, on a screen people
 * refresh constantly while an event is running, which is how it was being hit
 * by mistake.
 *
 * The confirm lives inside the form, so the "Yes" is the real submit button
 * rather than a handler that fires a second one. There is no state in which the
 * dialog has been answered and the form has not been posted.
 */
function TransitionForm({
  eventId,
  next,
  action,
}: {
  eventId: string;
  next: EventStatus;
  action: (formData: FormData) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <form action={action}>
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="status" value={next} />

      {isFinal(next) ? (
        <>
          <button type="button" className="btn btn-outline" onClick={() => setConfirming(true)}>
            {labelFor(next)}
          </button>
          {confirming ? <ConfirmDialog next={next} onDismiss={() => setConfirming(false)} /> : null}
        </>
      ) : (
        <Submit next={next} />
      )}
    </form>
  );
}

function ConfirmDialog({ next, onDismiss }: { next: EventStatus; onDismiss: () => void }) {
  const closing = next === 'COMPLETED';

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-navy-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="event-transition-title"
      onClick={onDismiss}
    >
      <div
        className="card w-full max-w-sm p-5 text-left"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="event-transition-title" className="text-base font-bold">
          {closing ? 'Close this event?' : 'Cancel this event?'}
        </h2>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          {closing
            ? 'Are you sure you want to close the event? Every QR for it stops accepting scans, and a closed event cannot be reopened.'
            : 'Are you sure you want to cancel the event? Every QR for it stops accepting scans, and a cancelled event cannot be reopened.'}
        </p>

        {/*
          "No" first, and it is the plain one. The destructive answer should
          never be the one a thumb lands on by default, on a screen somebody is
          tapping through quickly.
        */}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn btn-outline" onClick={onDismiss}>
            No
          </button>
          <ConfirmSubmit />
        </div>
      </div>
    </div>
  );
}

function ConfirmSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-accent">
      {pending ? 'Saving…' : 'Yes'}
    </button>
  );
}

function Submit({ next }: { next: EventStatus }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={next === 'RUNNING' ? 'btn btn-primary' : 'btn btn-outline'}
    >
      {pending ? 'Saving…' : labelFor(next)}
    </button>
  );
}
