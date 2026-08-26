'use client';

import { CLOSED_PERIOD_LABELS, CLOSED_PERIODS, type ClosedPeriod } from '@sihl-one/contracts';

/**
 * How far back the Closed column reaches.
 *
 * A plain GET form so the choice survives a bookmark and the back button, and
 * so it still works with no JavaScript — but a bare `<select>` inside a form
 * submits nothing on its own. The first version relied on that and was
 * therefore inert: changing the period simply did nothing, with no error to
 * suggest why.
 *
 * Submitting on change is the fix. The noscript button stays for the case the
 * change handler never arrives, which is the same case the form exists for.
 */
export function ClosedPeriodSelect({
  period,
  productInterest,
}: {
  period: ClosedPeriod;
  /** Carried through, or changing the window would clear the board's filter. */
  productInterest: string[];
}) {
  return (
    <form method="GET" className="mt-1.5">
      {productInterest.map((code) => (
        <input key={code} type="hidden" name="productInterest" value={code} />
      ))}

      <select
        name="period"
        defaultValue={period}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        aria-label="How far back to show closed work"
        className="w-full rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-1 text-xs font-semibold"
      >
        {CLOSED_PERIODS.map((value) => (
          <option key={value} value={value}>
            {CLOSED_PERIOD_LABELS[value]}
          </option>
        ))}
      </select>

      <noscript>
        <button
          type="submit"
          className="mt-1 w-full rounded-lg border border-[var(--color-border-strong)] px-2 py-1 text-xs font-semibold"
        >
          Apply
        </button>
      </noscript>
    </form>
  );
}
