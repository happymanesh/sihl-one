'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { MfaSetupResponse, MfaStatus } from '@sihl-one/contracts';

import { Badge } from '@/components/ui/Badge';
import { CopyField } from '@/components/ui/CopyField';
import { disableMfa, enableMfa, type MfaState } from '@/app/actions/mfa';
import { formatDate } from '@/lib/format';

const INITIAL: MfaState = { status: 'idle' };

export function MfaPanel({
  status,
  setup,
  qr,
}: {
  status: MfaStatus;
  setup: MfaSetupResponse | null;
  /**
   * The QR, rendered on the server and passed in.
   *
   * The `otpauth://` URI *contains the shared secret*. Handing it to any
   * third-party QR service — which is the tempting one-line version — posts
   * that secret to someone else's access log, and the second factor is theirs
   * from that moment. It is encoded locally or not at all.
   */
  qr: React.ReactNode;
}) {
  const [enableState, enableAction] = useActionState(enableMfa, INITIAL);
  const [disableState, disableAction] = useActionState(disableMfa, INITIAL);
  const [showManual, setShowManual] = useState(false);

  // Shown once, immediately after enrolment, and never retrievable again.
  if (enableState.status === 'success' && enableState.recoveryCodes) {
    return <RecoveryCodes codes={enableState.recoveryCodes} />;
  }

  if (status.enabled) {
    return (
      <section className="card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-bold">Two-step verification</h2>
          <Badge tone="green">On</Badge>
        </div>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {status.enrolledAt ? `Turned on ${formatDate(status.enrolledAt)}. ` : ''}
          {status.recoveryCodesRemaining} recovery{' '}
          {status.recoveryCodesRemaining === 1 ? 'code' : 'codes'} left.
        </p>

        {status.recoveryCodesRemaining <= 2 ? (
          <p className="mt-3 rounded-lg border border-warn-500/40 bg-warn-50 px-3 py-2 text-xs text-warn-600 dark:bg-warn-500/15">
            You are nearly out of recovery codes. Turn two-step verification off and on again to
            get a fresh set — do it while you still have your phone, not after you lose it.
          </p>
        ) : null}

        <hr className="my-4 border-[var(--color-border)]" />

        <form action={disableAction} className="space-y-3">
          <p className="text-sm font-semibold">Turn it off</p>
          <p className="text-xs text-[var(--color-text-muted)]">
            {/* Both factors, because this removes one of them. */}
            Your password and a current code are both required.
          </p>

          <Feedback state={disableState} />

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="disable-password">
                Password
              </label>
              <input
                id="disable-password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="input"
              />
            </div>
            <div>
              <label className="label" htmlFor="disable-code">
                Code
              </label>
              <input
                id="disable-code"
                name="code"
                required
                inputMode="text"
                maxLength={20}
                placeholder="123456"
                className="input font-mono"
              />
            </div>
          </div>

          <Submit label="Turn off two-step verification" pendingLabel="Turning off…" variant="outline" />
        </form>
      </section>
    );
  }

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold">Two-step verification</h2>
        <Badge tone="amber">Off</Badge>
      </div>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        A code from your phone, on top of your password. This is what stops a stolen or reused
        password from being enough on its own.
      </p>

      {setup ? (
        <form action={enableAction} className="mt-4 space-y-4">
          <input type="hidden" name="secret" value={setup.secret} />

          <ol className="space-y-4 text-sm">
            <li>
              <p className="font-semibold">1. Scan this in your authenticator app</p>
              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                Google Authenticator, Microsoft Authenticator, 1Password — any of them.
              </p>
              <div className="mt-2 flex flex-wrap items-start gap-4">
                {qr}
                <div className="min-w-[14rem] flex-1">
                  <button
                    type="button"
                    onClick={() => setShowManual((open) => !open)}
                    className="text-xs font-semibold text-navy-600 underline underline-offset-2 dark:text-teal-300"
                  >
                    {showManual ? 'Hide' : 'Can’t scan? Enter the key by hand'}
                  </button>
                  {showManual ? (
                    <div className="mt-2">
                      <CopyField value={setup.secret} label="Setup key" />
                    </div>
                  ) : null}
                </div>
              </div>
            </li>

            <li>
              <p className="font-semibold">2. Enter the code it shows</p>
              <Feedback state={enableState} />
              <input
                name="code"
                required
                inputMode="numeric"
                maxLength={7}
                placeholder="123456"
                className="input mt-2 max-w-[12rem] font-mono tracking-widest"
                aria-label="Six-digit code"
              />
            </li>
          </ol>

          <Submit label="Turn on two-step verification" pendingLabel="Verifying…" />
        </form>
      ) : null}
    </section>
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <section className="card border-teal-500/40 p-5">
      <h2 className="font-bold">Two-step verification is on</h2>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        Save these recovery codes somewhere safe. Each one works once, and this is the only time
        they will be shown — SIHL cannot retrieve them for you later.
      </p>

      <ul className="mt-4 grid grid-cols-2 gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 font-mono text-sm">
        {codes.map((code) => (
          <li key={code} className="tracking-wider">
            {code}
          </li>
        ))}
      </ul>

      <div className="mt-3">
        <CopyField value={codes.join('\n')} label="All recovery codes" />
      </div>

      <p className="mt-3 text-xs text-[var(--color-text-subtle)]">
        If you lose your phone, one of these gets you back in. Without them, an administrator has
        to reset your account.
      </p>
    </section>
  );
}

function Feedback({ state }: { state: MfaState }) {
  if (state.status === 'idle' || !state.message) return null;
  const isError = state.status === 'error';
  return (
    <p
      role="alert"
      className={`mt-2 rounded-lg px-3 py-2 text-sm ${
        isError
          ? 'border border-danger-500/40 bg-danger-50 text-danger-600 dark:bg-danger-500/15'
          : 'border border-teal-500/40 bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-200'
      }`}
    >
      {state.message}
    </p>
  );
}

function Submit({
  label,
  pendingLabel,
  variant = 'primary',
}: {
  label: string;
  pendingLabel: string;
  variant?: 'primary' | 'outline';
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`btn btn-${variant}`} disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}
