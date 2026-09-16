'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  LEAD_LOST_REASONS,
  LEAD_PRODUCT_STATUSES,
  type LeadProductView,
} from '@sihl-one/contracts';

import { changeLeadProductStatus, type ActionState } from '@/app/actions/leads';
import { ConversionFields } from '@/components/leads/ConversionFields';
import { formatCurrency, humanise } from '@/lib/format';

const INITIAL: ActionState = { status: 'idle' };

/**
 * The save button, which knows whether its own form is in flight.
 *
 * Its own component because `useFormStatus` reads the form it sits *inside*;
 * called from the panel body it would always report idle.
 */
function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn btn-primary h-9 px-3 text-sm disabled:opacity-60"
    >
      {pending ? 'Updating…' : 'Update Product Lead Stage'}
    </button>
  );
}

/**
 * Where each product on this lead stands.
 *
 * A client interested in equity, F&O and mutual funds does not close all three
 * on one day, so each carries its own outcome and the lead's status is rolled
 * up from them. That roll-up happens on the server, which is why nothing here
 * asks the rep what the change means for the lead — they record what happened
 * to one product and the rest follows.
 *
 * Open products come first. A rep opening this is deciding what to do next, and
 * the things still to do belong above the things already settled.
 */
const TONES: Record<string, string> = {
  NEW: 'border-[var(--color-border-strong)] text-[var(--color-text-muted)]',
  CONTACTED: 'border-[var(--color-border-strong)] text-[var(--color-text-muted)]',
  QUALIFIED: 'border-teal-500/50 text-teal-700 dark:text-teal-300',
  PROPOSAL: 'border-teal-500 text-teal-700 dark:text-teal-300',
  CONVERTED: 'border-teal-600 bg-teal-500 text-white',
  LOST: 'border-danger-500/50 text-danger-600',
  DISQUALIFIED: 'border-[var(--color-border)] text-[var(--color-text-subtle)]',
};

export function LeadProductOutcomes({
  leadId,
  outcomes,
  canEdit,
}: {
  leadId: string;
  outcomes: LeadProductView[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [state, action] = useActionState(changeLeadProductStatus, INITIAL);
  const [editing, setEditing] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  /*
    Keyed on the whole state, not `state.status`.

    Two successful saves in a row leave that string identical, so React sees no
    dependency change and never re-runs — the panel stayed open on every update
    after the first. `useActionState` hands back a fresh object per submission,
    so its identity is what actually means "something just came back", whether
    or not the outcome reads the same as last time.
  */
  useEffect(() => {
    if (state.status === 'success') {
      setEditing(null);
      router.refresh();
    }
  }, [state, router]);

  if (outcomes.length === 0) return null;

  const ordered = [...outcomes].sort((a, b) => Number(b.isOpen) - Number(a.isOpen));

  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-bold">Products</h2>
        <span className="text-xs text-[var(--color-text-subtle)]">
          {ordered.filter((row) => row.isOpen).length} open of {ordered.length}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
        Each one closes on its own. The lead&rsquo;s stage follows whichever is furthest along.
      </p>

      {state.status === 'error' && state.message ? (
        <p
          role="alert"
          className="mt-2 rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600 dark:bg-danger-500/15"
        >
          {state.message}
        </p>
      ) : null}

      <ul className="mt-3 space-y-2">
        {ordered.map((row) => (
          <li
            key={row.productCode}
            className="rounded-lg border border-[var(--color-border)] px-3 py-2"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {row.productName ?? row.productCode}
                </p>
                {row.lostReason ? (
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {humanise(row.lostReason)}
                  </p>
                ) : null}

                {/*
                  What was recorded, beside the product it was recorded for.

                  A fixed label column rather than free-flowing text, so amount
                  sits under amount and PAN under PAN when a lead carries three
                  products — the point of the request was reading down the
                  column, not just having the values present somewhere.
                */}
                {row.finalAmount || row.conversionRef || row.note ? (
                  <dl className="mt-1.5 grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-0.5 text-xs">
                    {row.finalAmount ? (
                      <>
                        <dt className="text-[var(--color-text-subtle)]">Final amount</dt>
                        <dd className="tnum font-semibold">
                          {formatCurrency(row.finalAmount)}
                        </dd>
                      </>
                    ) : null}
                    {row.conversionRef ? (
                      <>
                        <dt className="text-[var(--color-text-subtle)]">
                          {row.conversionRefKind === 'PAN' ? 'PAN' : 'Client code'}
                        </dt>
                        <dd className="font-mono font-semibold">{row.conversionRef}</dd>
                      </>
                    ) : null}
                    {row.note ? (
                      <>
                        <dt className="text-[var(--color-text-subtle)]">Remarks</dt>
                        <dd className="whitespace-pre-wrap text-[var(--color-text-muted)]">
                          {row.note}
                        </dd>
                      </>
                    ) : null}
                  </dl>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`rounded-lg border px-2 py-0.5 text-xs font-semibold ${
                    TONES[row.status] ?? TONES.NEW
                  }`}
                >
                  {humanise(row.status)}
                </span>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(editing === row.productCode ? null : row.productCode);
                      setStatus(row.status);
                    }}
                    className="text-xs font-semibold text-teal-600 underline underline-offset-2 dark:text-teal-300"
                  >
                    {editing === row.productCode ? 'Cancel' : 'Change'}
                  </button>
                ) : null}
              </div>
            </div>

            {editing === row.productCode ? (
              <form action={action} className="mt-2 space-y-2 border-t border-[var(--color-border)] pt-2">
                <input type="hidden" name="leadId" value={leadId} />
                <input type="hidden" name="productCode" value={row.productCode} />

                <div className="flex flex-wrap gap-2">
                  <select
                    name="status"
                    className="input h-9 w-auto text-sm"
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                    aria-label={`Outcome for ${row.productName ?? row.productCode}`}
                  >
                    {LEAD_PRODUCT_STATUSES.map((option) => (
                      <option key={option} value={option}>
                        {humanise(option)}
                      </option>
                    ))}
                  </select>

                  {/* Only for lost, matching the rule the schema enforces —
                      asking for a reason on every outcome trains people to type
                      "n/a" into the one place it matters. */}
                  {status === 'LOST' ? (
                    <select name="lostReason" className="input h-9 w-auto text-sm" required>
                      <option value="">Why lost?</option>
                      {LEAD_LOST_REASONS.map((reason) => (
                        <option key={reason} value={reason}>
                          {humanise(reason)}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>

                {/* Converting opens the customer record, so it asks for the
                    reference the back office knows the client by. Either kind
                    is accepted — a rep who has the client code should not be
                    sent away to look up a PAN. */}
                {status === 'CONVERTED' ? (
                  <div className="rounded-lg border border-teal-500/40 bg-teal-50/60 p-2.5 dark:bg-teal-500/10">
                    <ConversionFields
                      idPrefix={`panel-${row.productCode}`}
                      inputClassName="input h-9 text-sm"
                      invalid={Boolean(state.errors?.identifier)}
                    />
                  </div>
                ) : null}

                <input
                  name="note"
                  className="input h-9 text-sm"
                  placeholder="Remarks (optional)"
                  maxLength={1000}
                />

                {/*
                  One label for both outcomes. The button used to rename itself
                  to "Record conversion" when Converted was picked, which read
                  as a different action for what is one decision: say where this
                  product now stands.

                  Disabled while the save is in flight, because the panel closes
                  on success and a second click before that lands is a duplicate
                  conversion.
                */}
                <SubmitButton />
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
