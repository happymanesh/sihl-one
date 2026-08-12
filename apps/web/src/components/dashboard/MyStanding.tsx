import Link from 'next/link';
import type { Scorecard } from '@sihl-one/contracts';

import { formatCompactCurrency, humanise } from '@/lib/format';

/**
 * Where you stand, on the screen you already open every morning.
 *
 * Three numbers only — your rating, the gap to the best in your team, and the
 * one thing to do about it. The full picture lives on /performance; a scorecard
 * expanded inline would push the day's actual work below the fold.
 */
export function MyStanding({ card }: { card: Scorecard }) {
  const { rating, standing, target, nudges } = card;
  const gapToTop =
    standing.topPerformerOverall === null
      ? null
      : Math.max(0, standing.topPerformerOverall - rating.overall);
  const lever = nudges.find((nudge) => nudge.code !== 'MAINTAIN') ?? nudges[0];

  return (
    <section className="card p-5" aria-label="My standing">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-bold">Where you stand</h2>
        <Link
          href="/performance"
          className="text-xs font-semibold text-navy-600 underline underline-offset-2 dark:text-teal-300"
        >
          Full scorecard
        </Link>
      </div>

      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs text-[var(--color-text-muted)]">Your rating</p>
          <p className="mt-0.5 text-2xl font-bold tnum">{rating.overall}</p>
          <p className="text-xs text-[var(--color-text-subtle)]">
            {humanise(rating.band)} · {humanise(rating.confidence).toLowerCase()} confidence
          </p>
        </div>

        <div>
          <p className="text-xs text-[var(--color-text-muted)]">Gap to the best in your team</p>
          <p className="mt-0.5 text-2xl font-bold tnum">
            {gapToTop === null ? '—' : gapToTop === 0 ? 'You’re there' : `${gapToTop} pts`}
          </p>
          <p className="text-xs text-[var(--color-text-subtle)]">
            {standing.percentile === null
              ? 'No comparison available yet'
              : `Ahead of ${standing.percentile}% of your team`}
          </p>
        </div>

        <div>
          <p className="text-xs text-[var(--color-text-muted)]">Against target</p>
          <p className="mt-0.5 text-2xl font-bold tnum">
            {rating.targetAttainment === null ? '—' : `${rating.targetAttainment}%`}
          </p>
          <p className="text-xs text-[var(--color-text-subtle)]">
            {target
              ? // Pacing, not raw attainment: 50% attainment halfway through a
                // quarter is on track, and saying otherwise is just noise.
                `${target.expectedPacePercent}% through the period · ${formatCompactCurrency(target.achievedValue)} booked`
              : 'No target set for this period'}
          </p>
        </div>
      </div>

      {lever ? (
        <div className="mt-4 rounded-lg border-l-[3px] border-teal-500 bg-[var(--color-surface-muted)] py-2.5 pl-3 pr-2">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-subtle)]">
            Your biggest lever
          </p>
          <p className="mt-0.5 text-sm">{lever.action}</p>
        </div>
      ) : null}
    </section>
  );
}
