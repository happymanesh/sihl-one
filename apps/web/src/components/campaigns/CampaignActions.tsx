'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { CampaignStatus } from '@sihl-one/contracts';

import {
  changeCampaignStatus,
  recordSpend,
  type CampaignFormState,
} from '@/app/actions/campaigns';
import { humanise } from '@/lib/format';

const INITIAL: CampaignFormState = { status: 'idle' };

/**
 * Status changes and spend, in a popover rather than a permanent panel.
 *
 * Both are occasional actions on a screen that is read far more often than it
 * is edited, and giving them permanent space pushes the numbers people came
 * for below the fold.
 */
export function CampaignActions({
  campaignId,
  status,
  allowedTransitions,
  budget,
  actualSpend,
}: {
  campaignId: string;
  status: CampaignStatus;
  allowedTransitions: CampaignStatus[];
  budget: string | null;
  actualSpend: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} className="btn btn-outline">
        Manage
      </button>

      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-raised">
          <StatusForm
            campaignId={campaignId}
            status={status}
            allowedTransitions={allowedTransitions}
          />

          <hr className="my-4 border-[var(--color-border)]" />

          <SpendForm campaignId={campaignId} budget={budget} actualSpend={actualSpend} />
        </div>
      ) : null}
    </div>
  );
}

function StatusForm({
  campaignId,
  status,
  allowedTransitions,
}: {
  campaignId: string;
  status: CampaignStatus;
  allowedTransitions: CampaignStatus[];
}) {
  const [state, action] = useActionState(changeCampaignStatus, INITIAL);

  if (allowedTransitions.length === 0) {
    return (
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-subtle)]">
          Status
        </p>
        <p className="mt-1.5 text-sm text-[var(--color-text-muted)]">
          {/* Terminal by design: the spend and the attributed leads have
              already been reported against this campaign. */}
          {humanise(status)} is final. Start a new campaign rather than reopening this one.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="campaignId" value={campaignId} />
      <label
        className="block text-xs font-bold uppercase tracking-wide text-[var(--color-text-subtle)]"
        htmlFor="campaign-status"
      >
        Move to
      </label>
      <Feedback state={state} />
      <select id="campaign-status" name="status" className="input h-9" defaultValue="">
        <option value="" disabled>
          Choose a status
        </option>
        {allowedTransitions.map((next) => (
          <option key={next} value={next}>
            {humanise(next)}
          </option>
        ))}
      </select>
      <Submit label="Update status" pendingLabel="Updating…" />
    </form>
  );
}

function SpendForm({
  campaignId,
  budget,
  actualSpend,
}: {
  campaignId: string;
  budget: string | null;
  actualSpend: string | null;
}) {
  const [state, action] = useActionState(recordSpend, INITIAL);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="campaignId" value={campaignId} />
      <label
        className="block text-xs font-bold uppercase tracking-wide text-[var(--color-text-subtle)]"
        htmlFor="actualSpend"
      >
        Actual spend
      </label>
      <Feedback state={state} />
      <input
        id="actualSpend"
        name="actualSpend"
        type="number"
        min="0"
        step="1"
        defaultValue={actualSpend ?? ''}
        placeholder={budget ? `Budget ${budget}` : 'Amount in rupees'}
        className="input h-9"
      />
      <p className="text-xs text-[var(--color-text-subtle)]">
        Leave blank if unknown — blank and zero are read differently.
      </p>
      <Submit label="Save spend" pendingLabel="Saving…" />
    </form>
  );
}

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary h-9 w-full text-sm" disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

function Feedback({ state }: { state: CampaignFormState }) {
  if (state.status === 'idle' || !state.message) return null;
  const isError = state.status === 'error';
  return (
    <p
      role="alert"
      className={`rounded-lg px-2.5 py-1.5 text-xs ${
        isError
          ? 'border border-danger-500/40 bg-danger-50 text-danger-600 dark:bg-danger-500/15'
          : 'border border-teal-500/40 bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-200'
      }`}
    >
      {state.message}
    </p>
  );
}
