'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { completePasswordReset, type ResetState } from '@/app/actions/password-reset';

const INITIAL: ResetState = { status: 'idle' };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary w-full disabled:opacity-60">
      {pending ? 'Setting your password…' : 'Set my password'}
    </button>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState(completePasswordReset, INITIAL);

  if (state.status === 'done') {
    return (
      <div className="rounded-lg border border-teal-500/40 bg-teal-50 p-5 text-center dark:bg-teal-900/30">
        <h2 className="font-bold">Your password is set</h2>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          You have been signed out everywhere else. Sign in with the new password.
        </p>
        <p className="mt-4">
          <Link href="/login" className="btn btn-primary">
            Go to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4" noValidate>
      {/* The proof of identity. Carried through the form rather than kept in
          component state so a re-render after a validation error cannot lose
          it and strand somebody on a page that no longer works. */}
      <input type="hidden" name="token" value={token} />

      <div>
        <label className="label" htmlFor="newPassword">
          New password
        </label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          className="input"
          autoComplete="new-password"
          autoFocus
          required
          aria-invalid={Boolean(state.errors?.newPassword)}
        />
        {state.errors?.newPassword ? (
          <p className="mt-1 text-xs text-danger-500">{state.errors.newPassword[0]}</p>
        ) : null}
      </div>

      <div>
        <label className="label" htmlFor="confirmPassword">
          Confirm new password
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          className="input"
          autoComplete="new-password"
          required
          aria-invalid={Boolean(state.errors?.confirmPassword)}
        />
        {state.errors?.confirmPassword ? (
          <p className="mt-1 text-xs text-danger-500">{state.errors.confirmPassword[0]}</p>
        ) : null}
      </div>

      {state.status === 'error' && state.message ? (
        <p
          role="alert"
          className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600 dark:bg-danger-500/15"
        >
          {state.message}{' '}
          <Link href="/forgot-password" className="font-semibold underline underline-offset-2">
            Ask for a new link
          </Link>
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
