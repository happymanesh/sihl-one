'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { LeadPurgeCounts, LeadPurgePreview, LeadPurgeResult } from '@sihl-one/contracts';

import { previewPurge, purgeLead, PURGE_INITIAL, type PurgeState } from '@/app/actions/lead-purge';
import { humanise } from '@/lib/format';

/**
 * Permanently destroying a lead, in two deliberate steps.
 *
 * Everything here is shaped to be unlike a delete button. There is no row with
 * a bin icon and no menu item next to "Edit": the only way in is a page of its
 * own that a super admin has to go to, type a lead number into, read a list of
 * what would be destroyed, and then type the same number again.
 *
 * The second typing is the part that matters. A confirmation dialog with a
 * "Yes, delete" button is answered by muscle memory — people click it while
 * reading something else. Transcribing `LD-2026-000123` cannot be done without
 * looking at which lead this is, which is the only question worth asking.
 */

/** Labels for the count table. Order is the order they are shown in. */
const COUNT_LABELS: Array<[keyof LeadPurgeCounts, string]> = [
  ['activities', 'Interactions logged'],
  ['activityProductValues', 'Expected-investment lines'],
  ['tasks', 'Tasks'],
  ['visits', 'Visits'],
  ['visitExpenses', 'Expense claims'],
  ['attendees', 'Attendee records'],
  ['documents', 'Documents and evidence'],
  ['leadProducts', 'Product interests'],
  ['productApprovals', 'Product approvals'],
  ['statusHistory', 'Status history entries'],
  ['familyMembers', 'Family members'],
  ['profile', 'Client profile'],
  ['consentRecords', 'Consent ledger entries'],
  ['eventAttendances', 'Event attendances'],
  ['presentationBookings', 'Talk bookings'],
  ['messageLogs', 'Messages sent'],
  ['mobileOtps', 'Verification codes'],
  ['notifications', 'Notifications'],
  ['importRows', 'Import rows'],
  ['outboxEvents', 'Unrelayed events'],
];

function Submit({
  label,
  pendingLabel,
  danger,
}: {
  label: string;
  pendingLabel: string;
  danger?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={`btn ${danger ? 'btn-accent' : 'btn-primary'}`}
      disabled={pending}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

function Problem({ state }: { state: PurgeState }) {
  if (state.status !== 'error' || !state.message) return null;
  return (
    <div
      role="alert"
      className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600 dark:bg-danger-500/15"
    >
      {state.message}
    </div>
  );
}

export function PurgeLeadPanel() {
  const [lookup, lookupAction] = useActionState(previewPurge, PURGE_INITIAL);
  const [purge, purgeAction] = useActionState(purgeLead, PURGE_INITIAL);

  if (purge.status === 'purged' && purge.result) {
    return <Receipt result={purge.result} />;
  }

  return (
    <div className="space-y-4">
      <form action={lookupAction} className="card space-y-3 p-5">
        <div>
          <label className="label" htmlFor="reference">
            Lead number
          </label>
          <input
            id="reference"
            name="reference"
            className="input font-mono uppercase sm:max-w-xs"
            placeholder="LD-2026-000123"
            autoComplete="off"
            spellCheck={false}
            defaultValue={lookup.preview?.reference ?? ''}
            aria-invalid={Boolean(lookup.errors?.reference)}
          />
          <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
            The number printed on the lead, not its id from the address bar. Soft-deleted leads are
            found too.
          </p>
          {lookup.errors?.reference ? (
            <p className="mt-1 text-xs text-danger-500">{lookup.errors.reference[0]}</p>
          ) : null}
        </div>

        <Problem state={lookup} />
        <Submit label="Show what would be destroyed" pendingLabel="Looking up…" />
      </form>

      {lookup.status === 'preview' && lookup.preview ? (
        <ConfirmPurge preview={lookup.preview} action={purgeAction} state={purge} />
      ) : null}
    </div>
  );
}

function ConfirmPurge({
  preview,
  action,
  state,
}: {
  preview: LeadPurgePreview;
  action: (payload: FormData) => void;
  state: PurgeState;
}) {
  const [typed, setTyped] = useState('');
  const matches = typed.trim().toUpperCase() === preview.reference;

  const destroyed = COUNT_LABELS.filter(([key]) => preview.counts[key] > 0);
  const nothingAttached = destroyed.length === 0;

  return (
    <section className="card border-danger-500/40 p-5">
      <header className="border-b border-[var(--color-border)] pb-3">
        <h2 className="text-lg font-bold">
          {preview.name}{' '}
          <span className="font-mono text-sm font-normal text-[var(--color-text-muted)]">
            {preview.reference}
          </span>
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {preview.mobile} · {humanise(preview.status)}
          {preview.owner ? ` · owned by ${preview.owner}` : ' · unowned'} · created{' '}
          {new Date(preview.createdAt).toLocaleDateString('en-IN')}
          {preview.deletedAt ? ' · already soft-deleted' : null}
        </p>
      </header>

      <div className="grid gap-5 py-4 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold text-danger-600">Destroyed permanently</h3>
          {nothingAttached ? (
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">
              Nothing is attached to this lead. Only the lead record itself goes.
            </p>
          ) : (
            <dl className="mt-2 space-y-1 text-sm">
              {destroyed.map(([key, label]) => (
                <div key={key} className="flex justify-between gap-4">
                  <dt className="text-[var(--color-text-muted)]">{label}</dt>
                  <dd className="tnum font-semibold">{preview.counts[key]}</dd>
                </div>
              ))}
              {preview.storedFiles > 0 ? (
                <div className="flex justify-between gap-4 border-t border-[var(--color-border)] pt-1">
                  <dt className="text-[var(--color-text-muted)]">Files in the document store</dt>
                  <dd className="tnum font-semibold">{preview.storedFiles}</dd>
                </div>
              ) : null}
            </dl>
          )}

          {/* Called out on its own, because it is the one thing here that is
              arguably not the lead's to destroy — a rep's claim for money they
              have already spent. It cannot be kept: the claim hangs off the
              visit, and the visit carries the client's name and location. */}
          {preview.counts.visitExpenses > 0 ? (
            <p className="mt-3 rounded-lg border border-warn-500/40 bg-warn-50 px-3 py-2 text-xs text-warn-600 dark:bg-warn-500/10">
              This includes {preview.counts.visitExpenses} expense claim
              {preview.counts.visitExpenses === 1 ? '' : 's'} totalling ₹{preview.expenseClaimTotal}
              . Those are a rep&rsquo;s claims against SIHL. Settle them with finance before
              purging.
            </p>
          ) : null}
        </div>

        <div>
          <h3 className="text-sm font-semibold">Left standing</h3>
          <ul className="mt-2 space-y-1.5 text-sm text-[var(--color-text-muted)]">
            <li>
              {preview.retained.customer
                ? 'The customer this lead converted into — a client with an account.'
                : 'No customer record is attached.'}
            </li>
            <li>
              {preview.retained.mergedLeads > 0
                ? `${preview.retained.mergedLeads} lead(s) merged into this one stay, detached.`
                : 'No other lead was merged into this one.'}
            </li>
            <li>
              {preview.retained.messageOptOuts > 0
                ? `${preview.retained.messageOptOuts} standing opt-out(s) are kept — a refusal to be contacted is never destroyed.`
                : 'No standing opt-out is recorded.'}
            </li>
            <li>
              {preview.retained.duplicateCitations > 0
                ? `${preview.retained.duplicateCitations} import row(s) citing this lead as a duplicate are kept and detached.`
                : 'No import row cites this lead as a duplicate.'}
            </li>
            <li>The audit entry recording this purge, which survives the lead.</li>
          </ul>
        </div>
      </div>

      <form action={action} className="space-y-3 border-t border-[var(--color-border)] pt-4">
        <input type="hidden" name="reference" value={preview.reference} />

        <div>
          <label className="label" htmlFor="reason">
            Why is this being destroyed? <span className="text-danger-500">*</span>
          </label>
          <textarea
            id="reason"
            name="reason"
            rows={2}
            required
            minLength={20}
            className="input resize-none"
            placeholder="Erasure requested by the client under the DPDP Act on 30 Oct 2026, complaint ref CMP-118."
            aria-invalid={Boolean(state.errors?.reason)}
          />
          <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
            This is the only explanation that survives. Write it for somebody reading the audit
            trail in three years.
          </p>
          {state.errors?.reason ? (
            <p className="mt-1 text-xs text-danger-500">{state.errors.reason[0]}</p>
          ) : null}
        </div>

        <div>
          <label className="label" htmlFor="confirmReference">
            Type <span className="font-mono">{preview.reference}</span> to confirm
          </label>
          <input
            id="confirmReference"
            name="confirmReference"
            className="input font-mono uppercase sm:max-w-xs"
            autoComplete="off"
            spellCheck={false}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            aria-invalid={Boolean(state.errors?.confirmReference)}
          />
          {state.errors?.confirmReference ? (
            <p className="mt-1 text-xs text-danger-500">{state.errors.confirmReference[0]}</p>
          ) : null}
        </div>

        <Problem state={state} />

        {/*
          The one place in this app where a disabled submit is right. Elsewhere
          a disabled button hides its reason and the user hunts; here the
          reason is the sentence directly above it, and the cost of a stray
          click is a record nobody can get back.
        */}
        {matches ? (
          <Submit
            label={`Destroy ${preview.reference} permanently`}
            pendingLabel="Destroying…"
            danger
          />
        ) : (
          <button type="submit" className="btn btn-accent" disabled>
            Type the lead number to enable
          </button>
        )}
      </form>
    </section>
  );
}

/** What was actually destroyed. Shown once, and worth copying somewhere. */
function Receipt({ result }: { result: LeadPurgeResult }) {
  const destroyed = COUNT_LABELS.filter(([key]) => result.counts[key] > 0);

  return (
    <section className="card space-y-3 p-5">
      <h2 className="text-lg font-bold">{result.reference} is gone</h2>
      <p className="text-sm text-[var(--color-text-muted)]">
        {result.name} and {destroyed.reduce((sum, [key]) => sum + result.counts[key], 0)} related
        record(s) were destroyed at {new Date(result.purgedAt).toLocaleString('en-IN')}. This cannot
        be undone. The audit trail holds a count per table.
      </p>

      {result.filesFailed > 0 ? (
        <p className="rounded-lg border border-warn-500/40 bg-warn-50 px-3 py-2 text-sm text-warn-600 dark:bg-warn-500/10">
          {result.filesRemoved} of {result.filesRemoved + result.filesFailed} files were removed
          from the document store. {result.filesFailed} could not be, and now have nothing pointing
          at them — raise it with the platform team.
        </p>
      ) : (
        <p className="text-sm text-[var(--color-text-muted)]">
          {result.filesRemoved} file(s) removed from the document store.
        </p>
      )}

      <dl className="space-y-1 border-t border-[var(--color-border)] pt-3 text-sm">
        {destroyed.map(([key, label]) => (
          <div key={key} className="flex justify-between gap-4">
            <dt className="text-[var(--color-text-muted)]">{label}</dt>
            <dd className="tnum font-semibold">{result.counts[key]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
