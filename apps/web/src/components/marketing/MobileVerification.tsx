'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { OTP_LENGTH } from '@sihl-one/contracts';

import {
  resendCaptureCode,
  verifyCaptureMobile,
  type VerifyState,
} from '@/app/actions/lead-capture';

const INITIAL: VerifyState = { status: 'idle' };

function VerifyButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary h-12 w-full" disabled={pending}>
      {pending ? 'Checking…' : 'Verify my number'}
    </button>
  );
}

function ResendButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="text-sm font-semibold text-teal-600 underline underline-offset-2 disabled:opacity-50 disabled:no-underline dark:text-teal-300"
    >
      {pending ? 'Sending…' : disabled ? 'Send again shortly' : 'Send the code again'}
    </button>
  );
}

/**
 * The code step, shown after a registration has already been saved.
 *
 * Framed throughout as confirming a number rather than completing a
 * registration, because the registration is complete — the lead exists, the rep
 * has the details, and somebody who gives up here is still on the book. Telling
 * them otherwise would be untrue and would push people into retyping the form.
 */
export function MobileVerification({
  verificationId,
  maskedMobile,
  expiresInSeconds,
}: {
  verificationId: string;
  maskedMobile: string;
  expiresInSeconds: number;
}) {
  const [state, action] = useActionState(verifyCaptureMobile, INITIAL);
  const [resendState, resendAction] = useActionState(resendCaptureCode, INITIAL);
  const [secondsLeft, setSecondsLeft] = useState(expiresInSeconds);

  /*
    A countdown, because "valid for 10 minutes" is what the SMS says and a
    number ticking down is the difference between somebody waiting patiently and
    somebody pressing resend three times.
  */
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  // A fresh code restarts the clock.
  useEffect(() => {
    if (resendState.status === 'idle' && resendState.message) setSecondsLeft(expiresInSeconds);
  }, [resendState, expiresInSeconds]);

  if (state.status === 'verified') {
    return (
      <div className="mt-4 rounded-lg border border-teal-500/40 bg-teal-50 px-4 py-3 text-center dark:bg-teal-900/30">
        <p className="font-bold">Mobile number confirmed</p>
        <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
          Thank you — we know we can reach you on {maskedMobile}.
        </p>
      </div>
    );
  }

  const expired = secondsLeft <= 0;
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = String(secondsLeft % 60).padStart(2, '0');

  return (
    <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-4">
      <p className="font-bold">Confirm your mobile number</p>
      <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
        We have sent a {OTP_LENGTH}-digit code to {maskedMobile}.
      </p>

      <form action={action} className="mt-3 space-y-2">
        <input type="hidden" name="verificationId" value={verificationId} />
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={OTP_LENGTH}
          required
          placeholder={'•'.repeat(OTP_LENGTH)}
          aria-label="Verification code"
          // Wide tracking and a large face: this is read off one phone and typed
          // into another, often at arm's length in a noisy hall.
          className="input h-12 text-center text-xl font-bold tracking-[0.4em] tnum"
        />

        {state.status === 'error' && state.message ? (
          <p role="alert" className="text-sm text-danger-500">
            {state.message}
            {typeof state.attemptsRemaining === 'number' && state.attemptsRemaining > 0
              ? ` ${state.attemptsRemaining} ${state.attemptsRemaining === 1 ? 'try' : 'tries'} left.`
              : ''}
          </p>
        ) : null}

        <VerifyButton />
      </form>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-[var(--color-text-subtle)] tnum">
          {expired ? 'That code has expired.' : `Expires in ${minutes}:${seconds}`}
        </p>

        <form action={resendAction}>
          <input type="hidden" name="verificationId" value={verificationId} />
          {/* Only offered once the first code has had time to arrive, or has
              expired — a resend button pressed immediately just burns the cap. */}
          <ResendButton disabled={!expired && secondsLeft > expiresInSeconds - 30} />
        </form>
      </div>

      {resendState.message ? (
        <p
          className={`mt-1 text-xs ${
            resendState.status === 'error' ? 'text-danger-500' : 'text-[var(--color-text-muted)]'
          }`}
        >
          {resendState.message}
        </p>
      ) : null}

      <p className="mt-3 text-xs text-[var(--color-text-subtle)]">
        {/* The reassurance that stops somebody refilling the form. */}
        Your registration is already saved. Confirming the number just helps us reach you.
      </p>
    </div>
  );
}
