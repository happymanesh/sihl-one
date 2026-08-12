'use client';

import { useActionState } from 'react';
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
          <form key={next} action={action}>
            <input type="hidden" name="eventId" value={eventId} />
            <input type="hidden" name="status" value={next} />
            <Submit next={next} />
          </form>
        ))}
      </div>
    </div>
  );
}

function Submit({ next }: { next: EventStatus }) {
  const { pending } = useFormStatus();
  // Verbs, not statuses. "Cancelled" on a button reads as a label, not as
  // something that happens when you press it.
  const label =
    next === 'RUNNING'
      ? 'Start accepting scans'
      : next === 'COMPLETED'
        ? 'Close event'
        : next === 'CANCELLED'
          ? 'Cancel event'
          : humanise(next);

  return (
    <button
      type="submit"
      disabled={pending}
      className={next === 'RUNNING' ? 'btn btn-primary' : 'btn btn-outline'}
    >
      {pending ? 'Saving…' : label}
    </button>
  );
}
