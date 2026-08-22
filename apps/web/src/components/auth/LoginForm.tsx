'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { answerMfa, login, type LoginState } from '@/app/actions/auth';

const INITIAL: LoginState = { status: 'idle' };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary w-full" disabled={pending}>
      {pending ? 'Signing in…' : 'Sign in'}
    </button>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(login, INITIAL);
  const [showPassword, setShowPassword] = useState(false);

  // The password was right and a second factor is enrolled. The password form
  // is replaced rather than augmented — leaving it on screen invites a retype
  // that would only start the whole sign-in again.
  if (state.status === 'mfa' && state.challengeToken) {
    return <MfaStep state={state} next={next} />;
  }

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {/* Where the user was heading before being asked to sign in. Validated
          server-side — an unchecked value here is an open redirect. */}
      <input type="hidden" name="next" value={next ?? ''} />

      {state.status === 'error' && state.message ? (
        <div
          className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2.5 text-sm text-danger-600 dark:bg-danger-500/15"
          role="alert"
        >
          {state.message}
        </div>
      ) : null}

      <div>
        <label className="label" htmlFor="identifier">
          Email, mobile or code
        </label>
        <input
          id="identifier"
          name="identifier"
          className="input"
          required
          autoFocus
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby="identifier-hint"
          aria-invalid={state.status === 'error'}
        />
        {/* Partners were told to use their back-office code and would otherwise
            hunt for an email address they were never issued. */}
        <p id="identifier-hint" className="mt-1 text-xs text-[var(--color-text-subtle)]">
          Staff can use their employee code, partners their partner code.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="password">
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            className="input pr-16"
            required
            autoComplete="current-password"
            aria-invalid={state.status === 'error'}
          />
          {/*
            A reveal toggle rather than nothing: people mistype long passwords
            on phones, and the alternative is a lockout after five attempts.
          */}
          <button
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            aria-pressed={showPassword}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      <SubmitButton />

      <p className="text-center text-xs text-[var(--color-text-subtle)]">
        Five failed attempts will lock the account for 15 minutes.
      </p>
    </form>
  );
}

/**
 * Second-factor step.
 *
 * Accepts a recovery code in the same box as the six-digit code. Someone who
 * has lost their phone is already having a bad day; making them find a second
 * link labelled "use a recovery code instead" is a needless obstacle at exactly
 * the wrong moment. The API works out which kind it is.
 */
function MfaStep({ state, next }: { state: LoginState; next?: string }) {
  const [answerState, answerAction] = useActionState(answerMfa, state);

  return (
    <form action={answerAction} className="space-y-4" noValidate>
      <input type="hidden" name="challengeToken" value={state.challengeToken ?? ''} />
      <input type="hidden" name="next" value={next ?? state.next ?? ''} />

      <div>
        <h2 className="font-bold">Two-step verification</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Enter the six-digit code from your authenticator app.
        </p>
      </div>

      {answerState.status !== 'idle' && answerState.message ? (
        <div
          className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2.5 text-sm text-danger-600 dark:bg-danger-500/15"
          role="alert"
        >
          {answerState.message}
        </div>
      ) : null}

      <div>
        <label className="label" htmlFor="code">
          Code
        </label>
        <input
          id="code"
          name="code"
          required
          autoFocus
          autoComplete="one-time-code"
          // Not `type="number"`: a recovery code goes in the same box, and a
          // numeric input silently discards its letters.
          inputMode="text"
          maxLength={20}
          placeholder="123456"
          className="input font-mono tracking-widest"
        />
        <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
          Lost your phone? Enter one of your recovery codes instead.
        </p>
      </div>

      <VerifyButton />
    </form>
  );
}

function VerifyButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary w-full" disabled={pending}>
      {pending ? 'Checking…' : 'Verify'}
    </button>
  );
}
