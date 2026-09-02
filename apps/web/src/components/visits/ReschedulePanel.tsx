'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { rescheduleVisit, type VisitActionState } from '@/app/actions/visits';

const INITIAL: VisitActionState = { status: 'idle' };

/**
 * Correcting the time on a visit that has not started.
 *
 * Folded away behind a link rather than sitting open on the page: this is a
 * repair, not part of the normal flow, and a date field permanently on screen
 * invites someone to nudge a date they had no business touching.
 *
 * Only rendered for a PLANNED visit — once someone has checked in, the planned
 * time is part of what happened and the API refuses to move it.
 */
export function ReschedulePanel({
  visitId,
  plannedAt,
}: {
  visitId: string;
  plannedAt: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(rescheduleVisit, INITIAL);

  useEffect(() => {
    if (state.status === 'success') {
      setOpen(false);
      router.refresh();
    }
  }, [state.status, router]);

  // datetime-local wants `YYYY-MM-DDTHH:mm` in local time, and an ISO string
  // ending in Z is UTC. Slicing the ISO string would show a time five and a
  // half hours out from the one on the rest of the page.
  const localValue = (() => {
    if (!plannedAt) return '';
    const date = new Date(plannedAt);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
  })();

  if (!open) {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm font-semibold text-teal-600 underline underline-offset-2 dark:text-teal-300"
        >
          Change the date or time
        </button>
        {state.status === 'success' && state.message ? (
          <p className="mt-1 text-xs text-teal-600 dark:text-teal-300">{state.message}</p>
        ) : null}
      </div>
    );
  }

  return (
    <form action={action} className="mt-3 rounded-lg border border-[var(--color-border)] p-3">
      <input type="hidden" name="visitId" value={visitId} />

      <label className="label" htmlFor="plannedAt">
        Move this visit to
      </label>
      <input
        id="plannedAt"
        name="plannedAt"
        type="datetime-local"
        className="input"
        defaultValue={localValue}
        required
      />

      <div className="mt-2">
        <label className="label" htmlFor="rescheduleReason">
          Why, if it matters <span className="text-[var(--color-text-subtle)]">(optional)</span>
        </label>
        <input
          id="rescheduleReason"
          name="reason"
          className="input"
          maxLength={300}
          placeholder="Client asked to move it"
        />
      </div>

      {state.status === 'error' && state.message ? (
        <p role="alert" className="mt-2 text-sm text-danger-600">
          {state.message}
        </p>
      ) : null}

      <div className="mt-3 flex gap-2">
        <button type="submit" className="btn btn-primary h-9 px-3 text-sm">
          Move the visit
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="btn btn-outline h-9 px-3 text-sm"
        >
          Cancel
        </button>
      </div>

      <p className="mt-2 text-xs text-[var(--color-text-subtle)]">
        Only the time changes. The client, the mode and the purpose stay as they are.
      </p>
    </form>
  );
}
