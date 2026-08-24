'use client';

import { useEffect, useRef, useState } from 'react';
import type { DuplicateLeadMatch } from '@sihl-one/contracts';

import { formatDate } from '@/lib/format';

/**
 * Tells a rep the number they are typing is already ours, while they type it.
 *
 * The refusal on submit existed already. What it could not do is say who to
 * talk to, so a rep hit "duplicate lead" and had no idea whether that meant a
 * colleague was mid-conversation or a lead had been dead for a year.
 *
 * Debounced rather than fired per keystroke: an Indian mobile is ten digits and
 * the first nine of them are not a question worth asking the server.
 */
const DEBOUNCE_MS = 400;
const MOBILE_DIGITS = 10;

export function DuplicateMobileNotice({
  inputId = 'mobile',
  excludeLeadId,
  productLabels,
}: {
  inputId?: string;
  /** Set on the edit form, so a lead does not report itself. */
  excludeLeadId?: string;
  productLabels?: Record<string, string>;
}) {
  const [match, setMatch] = useState<DuplicateLeadMatch | null>(null);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    if (!input) return;

    const check = () => {
      const digits = input.value.replace(/\D/g, '').slice(-MOBILE_DIGITS);
      if (digits.length < MOBILE_DIGITS) {
        setMatch(null);
        return;
      }

      const params = new URLSearchParams({ mobile: digits });
      if (excludeLeadId) params.set('excludeLeadId', excludeLeadId);

      void fetch(`/api/leads/check-mobile?${params.toString()}`, { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: DuplicateLeadMatch | null) => setMatch(data?.exists ? data : null))
        // A failed check must never block capture. The write-side refusal is
        // still there; this is a courtesy and degrades to silence.
        .catch(() => setMatch(null));
    };

    const onInput = () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(check, DEBOUNCE_MS);
    };

    input.addEventListener('input', onInput);
    check();
    return () => {
      window.clearTimeout(timer.current);
      input.removeEventListener('input', onInput);
    };
  }, [inputId, excludeLeadId]);

  if (!match?.exists) return null;

  // Out of scope: the number is taken and that is all this rep may be told.
  if (!match.visible || !match.lead) {
    return (
      <p className="mt-1.5 rounded-lg border border-warn-500/40 bg-warn-50 px-2.5 py-1.5 text-xs text-warn-600 dark:bg-warn-500/15 dark:text-warn-100">
        This number is already on the book, with a team you do not have access to. Your manager
        can tell you who holds it.
      </p>
    );
  }

  const lead = match.lead;
  const products = lead.productInterest
    .map((code) => productLabels?.[code] ?? code)
    .join(', ');

  return (
    <>
      <div
        className={`mt-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${
          lead.isOpen
            ? 'border-warn-500/40 bg-warn-50 text-warn-600 dark:bg-warn-500/15 dark:text-warn-100'
            : 'border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]'
        }`}
      >
        <span className="font-semibold">
          {lead.isOpen ? 'Already an open lead' : 'Previously a lead'}
        </span>{' '}
        — {lead.name}
        {lead.ownerName ? `, with ${lead.ownerName}` : ''}, {formatDate(lead.createdAt)}.{' '}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="font-semibold underline underline-offset-2"
        >
          View details
        </button>
      </div>

      {open ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-navy-950/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dup-title"
          onClick={() => setOpen(false)}
        >
          <div className="card w-full max-w-sm p-5" onClick={(event) => event.stopPropagation()}>
            <h2 id="dup-title" className="text-base font-bold">
              {lead.name}
            </h2>
            <p className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">
              {lead.reference}
            </p>

            <dl className="mt-3 space-y-1.5 text-sm">
              <Row label="Status" value={lead.isOpen ? lead.status : `${lead.status} (closed)`} />
              <Row label="Owner" value={lead.ownerName ?? 'Unassigned'} />
              <Row label="Added" value={formatDate(lead.createdAt)} />
              <Row label="Interested in" value={products || '—'} />
            </dl>

            <div className="mt-4 flex gap-2">
              <a href={`/leads/${lead.id}`} className="btn btn-primary">
                Open the lead
              </a>
              <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-[var(--color-text-muted)]">{label}</dt>
      <dd className="min-w-0 flex-1 font-medium">{value}</dd>
    </div>
  );
}
