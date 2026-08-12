'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { issueCredentials, resetUserMfa, type UserFormState } from '@/app/actions/users';

const INITIAL: UserFormState = { status: 'idle' };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-outline" disabled={pending}>
      {pending ? 'Issuing…' : label}
    </button>
  );
}

/**
 * Issues a one-time password.
 *
 * Shown in the browser once because there is no email delivery yet; the
 * alternative is an account nobody can ever sign into. Everything about the
 * presentation assumes that is a temporary compromise: it is called out as
 * shown-once, it is never persisted anywhere client-side, and the user is
 * forced to change it at first sign-in.
 */
export function CredentialsPanel({
  userId,
  email,
  status,
}: {
  userId: string;
  email: string;
  status: string;
}) {
  const [state, action] = useActionState(issueCredentials, INITIAL);
  const neverSignedIn = status === 'INVITED';

  return (
    <section className="card p-5">
      <h2 className="font-bold">Sign-in credentials</h2>

      {state.credentials ? (
        <div className="mt-3 rounded-lg border border-warn-500/40 bg-warn-50 p-4 dark:bg-warn-500/10">
          <p className="text-sm font-bold">Temporary password — copy it now</p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            This is shown once and cannot be retrieved. If it is lost, issue a new one.
          </p>
          <dl className="mt-3 space-y-1.5 text-sm">
            <div className="flex flex-wrap gap-2">
              <dt className="text-[var(--color-text-muted)]">Email</dt>
              <dd className="font-mono font-semibold">{state.credentials.email}</dd>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <dt className="text-[var(--color-text-muted)]">Password</dt>
              <dd className="select-all rounded bg-[var(--color-surface)] px-2 py-1 font-mono text-base font-bold">
                {state.credentials.temporaryPassword}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-[var(--color-text-muted)]">
            They must change it at first sign-in. Any existing sessions have been signed out.
          </p>
        </div>
      ) : (
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {neverSignedIn
            ? 'This account has no password yet, so nobody can sign in as them. Issue a temporary one to activate it.'
            : 'Issue a new temporary password if they are locked out or have forgotten theirs. This signs them out everywhere.'}
        </p>
      )}

      {state.status === 'error' && state.message ? (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600 dark:bg-danger-500/15"
        >
          {state.message}
        </p>
      ) : null}

      <form action={action} className="mt-4">
        <input type="hidden" name="userId" value={userId} />
        <Submit label={neverSignedIn ? 'Issue credentials' : 'Reset password'} />
      </form>

      <p className="mt-3 text-xs text-[var(--color-text-subtle)]">
        Once email delivery exists this becomes a single-use invitation link and no password
        crosses the screen at all. Tracked on the production checklist. ({email})
      </p>

      <hr className="my-4 border-[var(--color-border)]" />

      <MfaResetForm userId={userId} />
    </section>
  );
}

/**
 * The way back from a lost phone.
 *
 * Kept behind a reason field rather than a bare button: this removes somebody's
 * second factor and signs out every device they have, which is not a thing to
 * do by mis-clicking. The API refuses it on your own account.
 */
function MfaResetForm({ userId }: { userId: string }) {
  const [state, action] = useActionState(resetUserMfa, INITIAL);

  return (
    <form action={action} className="space-y-2">
      <p className="text-sm font-semibold">Two-step verification</p>
      <p className="text-xs text-[var(--color-text-muted)]">
        Clear it only when they have lost their phone and their recovery codes. They will sign
        in with their password alone and can set it up again. Every device they are signed in on
        is signed out.
      </p>

      {state.status !== 'idle' && state.message ? (
        <p
          role="alert"
          className={`rounded-lg px-3 py-2 text-xs ${
            state.status === 'error'
              ? 'border border-danger-500/40 bg-danger-50 text-danger-600 dark:bg-danger-500/15'
              : 'border border-teal-500/40 bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-200'
          }`}
        >
          {state.message}
        </p>
      ) : null}

      <input type="hidden" name="userId" value={userId} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[14rem] flex-1">
          <label className="label" htmlFor="mfa-reason">
            Why
          </label>
          <input
            id="mfa-reason"
            name="reason"
            required
            minLength={5}
            maxLength={300}
            placeholder="Lost phone, no recovery codes left"
            className="input h-9"
          />
        </div>
        <Submit label="Clear two-step verification" />
      </div>
    </form>
  );
}
