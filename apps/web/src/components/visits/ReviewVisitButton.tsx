'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { reviewVisit, type VisitActionState } from '@/app/actions/visits';

const INITIAL: VisitActionState = { status: 'idle' };

/**
 * Accept a visit whose location evidence did not hold up.
 *
 * The note is optional and the button works without it. Requiring a reason
 * would be the wrong trade here: the common case is a manager clearing a
 * queue of visits they already know about, and a mandatory box turns a
 * thirty-second job into one nobody does — which is how the queue grew in the
 * first place.
 */
export function ReviewVisitButton({ visitId }: { visitId: string }) {
  const [state, action] = useActionState(reviewVisit, INITIAL);
  const [open, setOpen] = useState(false);

  if (state.status === 'success') {
    return <span className="text-xs font-semibold text-teal-600">Reviewed</span>;
  }

  return (
    <div className="space-y-2">
      {open ? (
        <form action={action} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="visitId" value={visitId} />
          <input
            name="note"
            maxLength={300}
            placeholder="What did you conclude? (optional)"
            aria-label="Review note"
            className="input h-8 flex-1 text-xs sm:max-w-xs"
          />
          <Submit />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-xs font-semibold text-[var(--color-text-muted)] underline underline-offset-2"
          >
            Cancel
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="btn btn-outline h-8 text-xs">
          Mark reviewed
        </button>
      )}

      {state.status === 'error' && state.message ? (
        <p role="alert" className="text-xs text-danger-500">
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary h-8 text-xs" disabled={pending}>
      {pending ? 'Saving…' : 'Accept'}
    </button>
  );
}
