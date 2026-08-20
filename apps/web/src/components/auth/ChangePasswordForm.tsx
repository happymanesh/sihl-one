'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { PASSWORD_MIN_LENGTH } from '@sihl-one/contracts';

import { changePassword, type ChangePasswordState } from '@/app/actions/password';

const INITIAL: ChangePasswordState = { status: 'idle' };

/**
 * The rules, derived from the shared constant rather than retyped.
 *
 * The API validates with the same `passwordSchema`; if the two are written out
 * separately they drift, and the screen ends up promising twelve characters
 * while the server quietly demands fourteen.
 */
const RULES: Array<{ label: string; test: (value: string) => boolean }> = [
  { label: `At least ${PASSWORD_MIN_LENGTH} characters`, test: (v) => v.length >= PASSWORD_MIN_LENGTH },
  { label: 'An uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { label: 'A lowercase letter', test: (v) => /[a-z]/.test(v) },
  { label: 'A digit', test: (v) => /\d/.test(v) },
  { label: 'A symbol', test: (v) => /[^A-Za-z0-9]/.test(v) },
];

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary w-full" disabled={pending}>
      {pending ? 'Saving…' : 'Set new password'}
    </button>
  );
}

export function ChangePasswordForm({ forced = false }: { forced?: boolean }) {
  const [state, action] = useActionState(changePassword, INITIAL);
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const met = RULES.map((rule) => rule.test(next));
  const mismatch = confirm.length > 0 && confirm !== next;

  return (
    <form action={action} className="space-y-4" noValidate>
      {state.status === 'error' && state.message ? (
        <p
          role="alert"
          className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600 dark:bg-danger-500/15"
        >
          {state.message}
        </p>
      ) : null}

      <div>
        <label className="label" htmlFor="currentPassword">
          {forced ? 'Temporary password' : 'Current password'}
        </label>
        <input
          id="currentPassword"
          name="currentPassword"
          type="password"
          className="input"
          autoComplete="current-password"
          required
          autoFocus
          aria-invalid={Boolean(state.errors?.currentPassword)}
        />
        {state.errors?.currentPassword ? (
          <p className="mt-1 text-xs text-danger-500">{state.errors.currentPassword[0]}</p>
        ) : null}
      </div>

      <div>
        <label className="label" htmlFor="newPassword">New password</label>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          className="input"
          autoComplete="new-password"
          required
          value={next}
          onChange={(event) => setNext(event.target.value)}
          aria-describedby="password-rules"
          aria-invalid={Boolean(state.errors?.newPassword)}
        />
        {/* Live rather than a static list: a rule that ticks as you type tells
            you which one you have missed without submitting to find out. */}
        <ul id="password-rules" className="mt-2 space-y-1">
          {RULES.map((rule, index) => (
            <li
              key={rule.label}
              className={`flex items-center gap-2 text-xs ${
                met[index]
                  ? 'text-teal-600 dark:text-teal-300'
                  : 'text-[var(--color-text-muted)]'
              }`}
            >
              <span aria-hidden className="font-bold">{met[index] ? '✓' : '·'}</span>
              <span>{rule.label}</span>
              <span className="sr-only">{met[index] ? '— met' : '— not yet met'}</span>
            </li>
          ))}
        </ul>
        {state.errors?.newPassword ? (
          <p className="mt-1 text-xs text-danger-500">{state.errors.newPassword[0]}</p>
        ) : null}
      </div>

      <div>
        <label className="label" htmlFor="confirmPassword">Confirm new password</label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          className="input"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          aria-invalid={mismatch || Boolean(state.errors?.confirmPassword)}
        />
        {mismatch ? (
          <p className="mt-1 text-xs text-danger-500">Both entries must match.</p>
        ) : state.errors?.confirmPassword ? (
          <p className="mt-1 text-xs text-danger-500">{state.errors.confirmPassword[0]}</p>
        ) : null}
      </div>

      <Submit />

      <p className="text-xs text-[var(--color-text-subtle)]">
        Every other signed-in device is signed out when the password changes.
      </p>
    </form>
  );
}
