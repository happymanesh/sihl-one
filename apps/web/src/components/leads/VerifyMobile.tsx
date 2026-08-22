'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  MOBILE_VERIFICATION_METHOD_LABELS,
  MOBILE_VERIFICATION_METHODS,
  type MobileVerificationMethod,
} from '@sihl-one/contracts';

import { unverifyLeadMobile, verifyLeadMobile, type ActionState } from '@/app/actions/leads';
import { formatDate } from '@/lib/format';

const INITIAL: ActionState = { status: 'idle' };

/**
 * Confirming that a lead's mobile number reaches the person it claims to.
 *
 * The wording throughout avoids implying the rep is suspected of anything. The
 * control asks how they reached the client, not whether they are telling the
 * truth — the number is the thing being checked, not the person recording it.
 */
export function VerifyMobile({
  leadId,
  verifiedAt,
  method,
  verifiedByName,
  canVerify,
}: {
  leadId: string;
  verifiedAt: string | null;
  method: MobileVerificationMethod | null;
  verifiedByName: string | null;
  /** False for anyone who is not the lead's owner — see the API for why. */
  canVerify: boolean;
}) {
  const router = useRouter();
  const [state, action] = useActionState(verifyLeadMobile, INITIAL);
  const [undoState, undoAction] = useActionState(unverifyLeadMobile, INITIAL);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (state.status === 'success' || undoState.status === 'success') {
      setOpen(false);
      router.refresh();
    }
  }, [state.status, undoState.status, router]);

  if (verifiedAt) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700 dark:bg-teal-900/40 dark:text-teal-200">
          <CheckIcon />
          Mobile confirmed
        </span>
        <span className="text-xs text-[var(--color-text-subtle)]">
          {method ? MOBILE_VERIFICATION_METHOD_LABELS[method] : 'Confirmed'} ·{' '}
          {formatDate(verifiedAt)}
          {verifiedByName ? ` · ${verifiedByName}` : ''}
        </span>

        {canVerify ? (
          <form action={undoAction}>
            <input type="hidden" name="leadId" value={leadId} />
            <button
              type="submit"
              className="text-xs font-semibold text-[var(--color-text-subtle)] underline underline-offset-2 hover:text-danger-500"
            >
              Undo
            </button>
          </form>
        ) : null}
      </div>
    );
  }

  if (!canVerify) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-text-subtle)]">
        <DotIcon />
        Mobile not confirmed
      </span>
    );
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs text-warn-600">
          <DotIcon />
          Mobile not confirmed
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs font-semibold text-teal-600 underline underline-offset-2 hover:text-teal-700 dark:text-teal-300"
        >
          Confirm it
        </button>
      </div>
    );
  }

  return (
    <form
      action={action}
      className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3"
    >
      <input type="hidden" name="leadId" value={leadId} />

      <p className="text-xs font-semibold">How did you reach this client?</p>

      <div className="mt-2 flex flex-wrap gap-2">
        {MOBILE_VERIFICATION_METHODS.map((value) => (
          <label
            key={value}
            className="cursor-pointer rounded-lg border border-[var(--color-border-strong)] px-2.5 py-1.5 text-xs font-semibold transition-colors has-[:checked]:border-teal-500 has-[:checked]:bg-teal-500 has-[:checked]:text-white"
          >
            {/* Labelled explicitly: the visible text sits beside a visually
                hidden input, and the accessibility tree was announcing the raw
                code — "IN_PERSON" rather than "Confirmed in person". */}
            <input
              type="radio"
              name="method"
              value={value}
              required
              aria-label={MOBILE_VERIFICATION_METHOD_LABELS[value]}
              className="sr-only"
            />
            {MOBILE_VERIFICATION_METHOD_LABELS[value]}
          </label>
        ))}
      </div>

      <input
        name="note"
        maxLength={200}
        placeholder="Anything worth noting — who answered, where you met (optional)"
        className="input mt-2 h-9 text-xs"
      />

      {state.status === 'error' && state.message ? (
        <p role="alert" className="mt-2 text-xs text-danger-500">
          {state.message}
        </p>
      ) : null}

      <div className="mt-2.5 flex gap-2">
        <button type="submit" className="btn btn-accent h-8 px-3 text-xs">
          Save
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="btn btn-outline h-8 px-3 text-xs"
        >
          Cancel
        </button>
      </div>

      <p className="mt-2 text-xs text-[var(--color-text-subtle)]">
        Editing the number later clears this, so it always refers to the number you actually
        reached.
      </p>
    </form>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
      <path d="M4 12.5 9.5 18 20 6.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DotIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden>
      <circle cx="4" cy="4" r="4" fill="currentColor" />
    </svg>
  );
}
