'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { requestPasswordReset, type ResetState } from '@/app/actions/password-reset';

const INITIAL: ResetState = { status: 'idle' };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary w-full disabled:opacity-60">
      {pending ? 'Sending…' : 'Send the reset link'}
    </button>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordReset, INITIAL);

  /*
    The confirmation says "if that account exists" and never more than that.

    It is the same sentence whether the identifier matched a live user, a
    suspended one, or nobody — because a form that confirms who holds an
    account lets anyone test whether a given person banks with SIHL. The API
    answers identically for the same reason; this screen simply must not undo
    it by being helpful.
  */
  if (state.status === 'sent') {
    return (
      <div className="rounded-lg border border-teal-500/40 bg-teal-50 p-5 text-center dark:bg-teal-900/30">
        <h2 className="font-bold">Check your email</h2>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">{state.message}</p>
        <p className="mt-4 text-sm">
          <Link
            href="/login"
            className="font-semibold text-teal-600 hover:underline dark:text-teal-300"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      <div>
        <label className="label" htmlFor="identifier">
          Email, mobile or employee code
        </label>
        <input
          id="identifier"
          name="identifier"
          className="input"
          autoComplete="username"
          autoFocus
          required
          aria-invalid={Boolean(state.errors?.identifier)}
        />
        <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
          We will email the address held on your staff record.
        </p>
        {state.errors?.identifier ? (
          <p className="mt-1 text-xs text-danger-500">{state.errors.identifier[0]}</p>
        ) : null}
      </div>

      {state.status === 'error' && state.message ? (
        <p
          role="alert"
          className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600 dark:bg-danger-500/15"
        >
          {state.message}
        </p>
      ) : null}

      <SubmitButton />

      <p className="text-center text-sm">
        <Link
          href="/login"
          className="font-semibold text-[var(--color-text-muted)] underline underline-offset-2 hover:text-[var(--color-text)]"
        >
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
