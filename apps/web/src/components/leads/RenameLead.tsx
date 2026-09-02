'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { renameLead, type ActionState } from '@/app/actions/leads';

const INITIAL: ActionState = { status: 'idle' };

/**
 * Fixing a name that was typed wrong at capture.
 *
 * Folded behind a small control next to the heading rather than sitting open:
 * a name field permanently on screen invites edits, and this is a repair.
 *
 * Hidden entirely once a lead is converted, because the API refuses to edit a
 * converted lead — the customer record owns the name from that point. Offering
 * a control that will be refused is worse than not offering it.
 */
export function RenameLead({
  leadId,
  firstName,
  lastName,
  canEdit,
}: {
  leadId: string;
  firstName: string;
  lastName: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(renameLead, INITIAL);

  useEffect(() => {
    if (state.status === 'success') {
      setOpen(false);
      router.refresh();
    }
  }, [state.status, router]);

  if (!canEdit) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-teal-600 underline underline-offset-2 dark:text-teal-300"
      >
        Correct spelling
      </button>
    );
  }

  return (
    <form action={action} className="mt-2 w-full rounded-lg border border-[var(--color-border)] p-3">
      <input type="hidden" name="leadId" value={leadId} />

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="min-w-0">
          <label className="label" htmlFor="rename-first">
            First name <span className="text-danger-500">*</span>
          </label>
          <input
            id="rename-first"
            name="firstName"
            className="input h-9 text-sm"
            defaultValue={firstName}
            required
            maxLength={80}
          />
        </div>
        <div className="min-w-0">
          <label className="label" htmlFor="rename-last">
            Last name
          </label>
          <input
            id="rename-last"
            name="lastName"
            className="input h-9 text-sm"
            defaultValue={lastName ?? ''}
            maxLength={80}
          />
        </div>
      </div>

      {state.status === 'error' && state.message ? (
        <p role="alert" className="mt-2 text-sm text-danger-600">
          {state.message}
        </p>
      ) : null}

      <div className="mt-2 flex gap-2">
        <button type="submit" className="btn btn-primary h-9 px-3 text-sm">
          Save the correction
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="btn btn-outline h-9 px-3 text-sm"
        >
          Cancel
        </button>
      </div>

      <p className="mt-2 text-xs text-[var(--color-text-subtle)]">
        Only the name changes. The mobile number is edited separately, because changing it clears
        the verification recorded against it.
      </p>
    </form>
  );
}
