'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  guessIdentifierKind,
  LEAD_LOST_REASONS,
  LEAD_PRODUCT_STATUSES,
  type LeadProductView,
} from '@sihl-one/contracts';

import { changeLeadProductStatus, type ActionState } from '@/app/actions/leads';
import { humanise } from '@/lib/format';

const INITIAL: ActionState = { status: 'idle' };

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
  const [identifier, setIdentifier] = useState('');
  const [kindOverride, setKindOverride] = useState<'PAN' | 'CLIENT_CODE' | null>(null);

  // Guessed from what is typed until the rep overrides it, and the override
  // then sticks: retyping a character should not undo a deliberate choice.
  const identifierKind = kindOverride ?? guessIdentifierKind(identifier);

  useEffect(() => {
    if (state.status === 'success') {
      setEditing(null);
      router.refresh();
    }
  }, [state.status, router]);

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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {row.productName ?? row.productCode}
                </p>
                {row.lostReason ? (
                  <p className="text-xs text-[var(--color-text-muted)]">
                    {humanise(row.lostReason)}
                  </p>
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
                  <div className="grid gap-2 rounded-lg border border-teal-500/40 bg-teal-50/60 p-2.5 sm:grid-cols-2 dark:bg-teal-500/10">
                    <div className="min-w-0">
                      {/* The kind sits on the label rather than under the field:
                          it is one word plus a way to correct it, and a
                          paragraph of explanation under every input pushed the
                          two fields apart for no one's benefit. */}
                      <div className="flex items-baseline justify-between gap-2">
                        <label className="label" htmlFor={`identifier-${row.productCode}`}>
                          PAN or client code <span className="text-danger-500">*</span>
                        </label>
                        <button
                          type="button"
                          className="text-xs font-semibold text-teal-700 underline underline-offset-2 dark:text-teal-300"
                          onClick={() =>
                            setKindOverride(identifierKind === 'PAN' ? 'CLIENT_CODE' : 'PAN')
                          }
                          aria-label={`Recorded as ${
                            identifierKind === 'PAN' ? 'a PAN' : 'a client code'
                          }. Record it as ${
                            identifierKind === 'PAN' ? 'a client code' : 'a PAN'
                          } instead.`}
                        >
                          Use {identifierKind === 'PAN' ? 'client code' : 'PAN'}
                        </button>
                      </div>
                      <input
                        id={`identifier-${row.productCode}`}
                        name="identifier"
                        className="input h-9 text-sm"
                        required
                        autoCapitalize="characters"
                        placeholder="ABCDE1234F or R0018"
                        value={identifier}
                        onChange={(event) => setIdentifier(event.target.value)}
                        aria-invalid={Boolean(state.errors?.identifier)}
                      />
                      <input type="hidden" name="identifierKind" value={identifierKind} />
                    </div>

                    <div className="min-w-0">
                      <label className="label" htmlFor={`finalAmount-${row.productCode}`}>
                        Final amount
                      </label>
                      <input
                        id={`finalAmount-${row.productCode}`}
                        name="finalAmount"
                        className="input h-9 text-sm"
                        inputMode="decimal"
                        placeholder="250000"
                      />
                    </div>
                  </div>
                ) : null}

                <input
                  name="note"
                  className="input h-9 text-sm"
                  placeholder="Note (optional)"
                  maxLength={1000}
                />

                <button type="submit" className="btn btn-primary h-9 px-3 text-sm">
                  {status === 'CONVERTED' ? 'Record conversion' : 'Record outcome'}
                </button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
