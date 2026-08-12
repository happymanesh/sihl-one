'use client';

import { useEffect, useState } from 'react';
import type { AllocationAdvice } from '@sihl-one/contracts';

type Advice = AllocationAdvice & { lead: { id: string; reference: string; score: number } };

/**
 * Who this lead should be offered to, and why.
 *
 * Deliberately a *suggestion* next to the owner picker rather than a
 * pre-selected value: the manager still has to choose. Rating-driven allocation
 * that acts on its own compounds — the best-rated rep gets the best leads and
 * rates higher still — and there would be nobody for a passed-over rep to
 * argue with. Picking a suggestion here fills the dropdown; it does not submit.
 */
export function OwnerSuggestions({
  leadId,
  onPick,
}: {
  leadId: string;
  onPick: (userId: string) => void;
}) {
  const [advice, setAdvice] = useState<Advice | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [showPassedOver, setShowPassedOver] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/leads/owner-suggestions?leadId=${encodeURIComponent(leadId)}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((data: Advice) => {
        if (!cancelled) {
          setAdvice(data);
          setState('ready');
        }
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [leadId]);

  // Suggestions are an aid. If they cannot be produced, the picker below still
  // works, so this fails quietly rather than blocking the assignment.
  if (state === 'error') return null;

  if (state === 'loading') {
    return (
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2.5 text-xs text-[var(--color-text-muted)]">
        Working out who is best placed for this lead…
      </div>
    );
  }

  if (!advice || advice.recommendations.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2.5 text-xs text-[var(--color-text-muted)]">
        {advice?.note ?? 'No suggestions available.'}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-bold">Suggested owners</p>
        <p className="text-xs text-[var(--color-text-subtle)]">
          {advice.leadBand === 'STRONG' ? 'High-value lead' : 'Standard lead'} · score{' '}
          {advice.lead.score}
        </p>
      </div>

      <ul className="mt-2.5 space-y-2">
        {advice.recommendations.map((recommendation) => (
          <li
            key={recommendation.userId}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-semibold">
                {recommendation.rank}. {recommendation.fullName}
                {recommendation.isDevelopmentPick ? (
                  <span className="ml-2 rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-semibold text-teal-700 dark:bg-teal-800 dark:text-teal-50">
                    Development pick
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                onClick={() => onPick(recommendation.userId)}
                className="text-xs font-semibold text-navy-600 underline underline-offset-2 hover:text-navy-800 dark:text-teal-300"
              >
                Choose
              </button>
            </div>
            <ul className="mt-1 space-y-0.5 text-xs text-[var(--color-text-muted)]">
              {recommendation.reasons.map((reason) => (
                <li key={reason}>· {reason}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      {advice.excluded.length > 0 ? (
        <div className="mt-2.5">
          <button
            type="button"
            onClick={() => setShowPassedOver((open) => !open)}
            className="text-xs font-semibold text-[var(--color-text-muted)] underline underline-offset-2"
            aria-expanded={showPassedOver}
          >
            {showPassedOver ? 'Hide' : 'Show'} who was passed over ({advice.excluded.length})
          </button>
          {/* The first question anyone asks a recommendation is "why isn't she
              on here?". A list that cannot answer it does not get used twice. */}
          {showPassedOver ? (
            <ul className="mt-1.5 space-y-0.5 text-xs text-[var(--color-text-muted)]">
              {advice.excluded.map((entry) => (
                <li key={entry.userId}>
                  <span className="font-semibold">{entry.fullName}</span> — {entry.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <p className="mt-2.5 text-xs text-[var(--color-text-subtle)]">{advice.note}</p>
    </div>
  );
}
