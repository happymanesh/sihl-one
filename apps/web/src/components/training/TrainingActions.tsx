'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { cancelTraining, deleteTraining, type TrainingState } from '@/app/actions/training';

const INITIAL: TrainingState = { status: 'idle' };

/**
 * Cancel or remove a session that has not run.
 *
 * Two different acts, deliberately worded differently. Cancelling keeps the
 * row — "it was scheduled and then called off" is a fact somebody will ask
 * about. Removing is for a session created by mistake, which nobody should be
 * asked to explain.
 */
export function TrainingActions({ trainingId }: { trainingId: string }) {
  const [cancelState, cancel] = useActionState(cancelTraining, INITIAL);
  const [deleteState, remove] = useActionState(deleteTraining, INITIAL);

  const message =
    cancelState.status === 'error'
      ? cancelState.message
      : deleteState.status === 'error'
        ? deleteState.message
        : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <form action={cancel}>
          <input type="hidden" name="id" value={trainingId} />
          <Button
            idle="Cancel session"
            busy="Cancelling…"
            confirm="Cancel this session? The branches will see it as cancelled."
          />
        </form>

        <form action={remove}>
          <input type="hidden" name="id" value={trainingId} />
          <Button
            idle="Remove"
            busy="Removing…"
            confirm="Remove this session and its attached material? This cannot be undone."
            tone="danger"
          />
        </form>
      </div>

      {message ? (
        <p role="alert" className="text-xs text-danger-500">
          {message}
        </p>
      ) : null}
    </div>
  );
}

function Button({
  idle,
  busy,
  confirm,
  tone = 'outline',
}: {
  idle: string;
  busy: string;
  confirm: string;
  tone?: 'outline' | 'danger';
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      // The confirm runs in the submit event, so returning false stops the
      // action rather than cancelling it after it has already been sent.
      onClick={(event) => {
        if (!window.confirm(confirm)) event.preventDefault();
      }}
      className={
        tone === 'danger'
          ? 'btn btn-outline border-danger-500/50 text-danger-600 hover:bg-danger-50 dark:hover:bg-danger-500/15'
          : 'btn btn-outline'
      }
    >
      {pending ? busy : idle}
    </button>
  );
}
