'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import type { DuplicateGroup } from '@sihl-one/contracts';

import { LeadStatusBadge } from '@/components/ui/Badge';
import { mergeLeads, type MergeState } from '@/app/actions/duplicates';
import { formatDate } from '@/lib/format';

const INITIAL: MergeState = { status: 'idle' };

/**
 * One set of records that look like the same person.
 *
 * The reviewer picks which record survives. That choice is theirs and not the
 * system's, because it decides who keeps the relationship — and a machine
 * quietly reassigning a colleague's lead is the failure this whole flow exists
 * to avoid. The suggestion is shown with its reasoning; it is not preselected
 * silently.
 */
export function DuplicateGroupCard({ group }: { group: DuplicateGroup }) {
  const [state, action] = useActionState(mergeLeads, INITIAL);
  const [survivorId, setSurvivorId] = useState(group.suggestedSurvivorId);
  const [duplicateId, setDuplicateId] = useState<string>(
    group.leads.find((lead) => lead.id !== group.suggestedSurvivorId)?.id ?? '',
  );

  if (state.status === 'success') {
    return (
      <li className="card border-teal-500/40 p-4 text-sm">
        <p className="font-semibold text-teal-700 dark:text-teal-300">{state.message}</p>
      </li>
    );
  }

  const converted = group.leads.filter((lead) => lead.customerId !== null);

  return (
    <li className="card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-bold">
          {group.leads.length} leads share the same{' '}
          {group.key === 'MOBILE' ? 'mobile number' : group.key === 'EMAIL' ? 'email' : 'PAN'}
        </p>
        <span className="font-mono text-xs text-[var(--color-text-subtle)]">{group.keyLabel}</span>
      </div>

      {group.signals.length > 0 ? (
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          {group.signals.map((signal) => signal.label).join(' · ')}
        </p>
      ) : null}

      <form action={action} className="mt-3 space-y-3">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-[var(--color-text-subtle)]">
              <tr>
                <th scope="col" className="py-1 pr-3 font-bold uppercase tracking-wide">Keep</th>
                <th scope="col" className="py-1 pr-3 font-bold uppercase tracking-wide">Merge away</th>
                <th scope="col" className="py-1 pr-3 font-bold uppercase tracking-wide">Lead</th>
                <th scope="col" className="py-1 pr-3 font-bold uppercase tracking-wide">Status</th>
                <th scope="col" className="py-1 pr-3 font-bold uppercase tracking-wide">Owner</th>
                <th scope="col" className="py-1 font-bold uppercase tracking-wide">History</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {group.leads.map((lead) => (
                <tr key={lead.id}>
                  <td className="py-2 pr-3">
                    <input
                      type="radio"
                      name="survivorId"
                      value={lead.id}
                      checked={survivorId === lead.id}
                      onChange={() => {
                        setSurvivorId(lead.id);
                        if (duplicateId === lead.id) setDuplicateId('');
                      }}
                      aria-label={`Keep ${lead.reference}`}
                      className="accent-teal-500"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      type="radio"
                      name="duplicateId"
                      value={lead.id}
                      checked={duplicateId === lead.id}
                      disabled={survivorId === lead.id}
                      onChange={() => setDuplicateId(lead.id)}
                      aria-label={`Merge away ${lead.reference}`}
                      className="accent-danger-500"
                    />
                  </td>
                  <td className="py-2 pr-3">
                    <Link
                      href={`/leads/${lead.id}`}
                      className="font-semibold hover:text-teal-600 hover:underline dark:hover:text-teal-300"
                    >
                      {lead.fullName}
                    </Link>
                    <div className="font-mono text-xs text-[var(--color-text-subtle)]">
                      {lead.reference} · {lead.mobileMasked} · {formatDate(lead.createdAt)}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <LeadStatusBadge status={lead.status} />
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    {lead.owner?.fullName ?? (
                      <span className="text-[var(--color-text-subtle)]">Unassigned</span>
                    )}
                  </td>
                  <td className="py-2 text-xs tnum">
                    {lead.activityCount} {lead.activityCount === 1 ? 'note' : 'notes'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-[var(--color-text-muted)]">
          Suggested: keep{' '}
          <span className="font-mono">
            {group.leads.find((lead) => lead.id === group.suggestedSurvivorId)?.reference}
          </span>{' '}
          — {group.suggestedBecause}
        </p>

        {converted.length > 0 ? (
          <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
            {/* A converted lead has a customer behind it that may already carry
                a client code from the back office. */}
            {converted.length === 1
              ? `${converted[0]!.reference} has already been converted, so it can only be kept, never merged away.`
              : 'More than one of these has been converted. Those accounts already exist and cannot be merged here — ask operations.'}
          </p>
        ) : null}

        {state.status === 'error' && state.message ? (
          <p
            role="alert"
            className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-xs text-danger-600 dark:bg-danger-500/15"
          >
            {state.message}
          </p>
        ) : null}

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[18rem] flex-1">
            <label className="label" htmlFor={`reason-${group.leads[0]!.id}`}>
              Why are these the same person?
            </label>
            <input
              id={`reason-${group.leads[0]!.id}`}
              name="reason"
              required
              minLength={5}
              maxLength={300}
              placeholder="Walked into the branch after enquiring online"
              className="input h-9"
            />
          </div>
          <Submit disabled={!survivorId || !duplicateId} />
        </div>

        <p className="text-xs text-[var(--color-text-subtle)]">
          Nothing is deleted. The merged record is closed and points at the one you keep, and its
          notes, documents and consent move across.
        </p>
      </form>
    </li>
  );
}

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn btn-primary h-9" disabled={pending || disabled}>
      {pending ? 'Merging…' : 'Merge'}
    </button>
  );
}
