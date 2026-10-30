'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { deleteQuestion, retireQuestion, type QuestionState } from '@/app/actions/questions';

const INITIAL: QuestionState = { status: 'idle' };

/**
 * Retire or remove a question.
 *
 * Two different acts, and which one is even offered depends on whether a
 * published test holds a copy. Retiring takes a question out of circulation
 * while leaving every past paper intact; removing is for one written by
 * mistake, which nothing has ever used.
 */
export function QuestionActions({
  questionId,
  isActive,
  usedInTests,
}: {
  questionId: string;
  isActive: boolean;
  usedInTests: number;
}) {
  const [retireState, retire] = useActionState(retireQuestion, INITIAL);
  const [deleteState, remove] = useActionState(deleteQuestion, INITIAL);

  const message =
    retireState.status === 'error'
      ? retireState.message
      : deleteState.status === 'error'
        ? deleteState.message
        : null;

  return (
    <div className="space-y-2 border-t border-[var(--color-border)] pt-4">
      <div className="flex flex-wrap gap-2">
        <form action={retire}>
          <input type="hidden" name="id" value={questionId} />
          <input type="hidden" name="isActive" value={isActive ? 'false' : 'true'} />
          <Button
            idle={isActive ? 'Retire' : 'Put back in circulation'}
            busy="Saving…"
            confirm={
              isActive
                ? 'Retire this question? No new test will draw on it. Tests already sat keep it.'
                : undefined
            }
          />
        </form>

        {/*
          Deletion is offered only while nothing has used it. Afterwards it
          would change no past result — the test holds its own copy — and
          would only lose the question for everyone writing new ones.
        */}
        {usedInTests === 0 ? (
          <form action={remove}>
            <input type="hidden" name="id" value={questionId} />
            <Button
              idle="Delete"
              busy="Deleting…"
              confirm="Delete this question and every wording of it? This cannot be undone."
              tone="danger"
            />
          </form>
        ) : null}
      </div>

      {usedInTests > 0 ? (
        <p className="text-xs text-[var(--color-text-subtle)]">
          In {usedInTests} published test{usedInTests === 1 ? '' : 's'}, so it can be retired but
          not deleted.
        </p>
      ) : null}

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
  confirm?: string;
  tone?: 'outline' | 'danger';
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
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
