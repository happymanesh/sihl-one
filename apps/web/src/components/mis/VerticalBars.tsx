'use client';

import { useState } from 'react';
import type { MisVerticalSummary } from '@sihl-one/contracts';
import { MIS_LEAD_GROUP_LABELS } from '@sihl-one/contracts';

/**
 * Verticals compared, and what each is holding.
 *
 * Hand-drawn bars rather than a charting component, for two reasons. The
 * comparison is a magnitude question with a handful of rows, which a bar and
 * a number answer better than a plot; and the composition bar underneath needs
 * each segment labelled and separated by a hairline, which is fiddly to impose
 * on a library and trivial in CSS.
 *
 * **Colour carries no identity here.** The brand has three usable hues and
 * they are adjacent — navy through teal to green — so no three of them clear
 * the normal-vision separation floor, which means a reader with full colour
 * vision could not reliably tell two verticals apart. A vertical is therefore
 * named in the row, the length carries the magnitude, and the composition uses
 * one hue light-to-dark because its four parts are ordered stages rather than
 * unrelated categories.
 */
export function VerticalBars({ verticals }: { verticals: MisVerticalSummary[] }) {
  const [asTable, setAsTable] = useState(false);
  const largest = Math.max(1, ...verticals.map((v) => v.counts.total));

  if (verticals.length === 0) {
    return (
      <section className="card">
        <h2 className="text-base font-bold">Verticals</h2>
        <p className="mt-3 text-sm text-[var(--color-text-muted)]">
          Nobody reports to the chief executive yet, so there are no verticals to compare.
        </p>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold">Verticals compared</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            Every lead each vertical holds, and how it breaks down
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAsTable((showing) => !showing)}
          className="text-xs font-semibold text-teal-600 underline underline-offset-2 dark:text-teal-300"
        >
          {asTable ? 'View as chart' : 'View as table'}
        </button>
      </div>

      {asTable ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left">
              <tr>
                <Th>Vertical</Th>
                <Th className="text-right">{MIS_LEAD_GROUP_LABELS.untouched}</Th>
                <Th className="text-right">{MIS_LEAD_GROUP_LABELS.inProgress}</Th>
                <Th className="text-right">{MIS_LEAD_GROUP_LABELS.converted}</Th>
                <Th className="text-right">{MIS_LEAD_GROUP_LABELS.lost}</Th>
                <Th className="text-right">Total</Th>
                <Th className="text-right">Rate</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {verticals.map((v) => (
                <tr key={v.userId}>
                  <td className="py-1.5 font-medium">{v.name}</td>
                  <td className="py-1.5 text-right tnum">{v.counts.untouched}</td>
                  <td className="py-1.5 text-right tnum">{v.counts.inProgress}</td>
                  <td className="py-1.5 text-right tnum">{v.counts.converted}</td>
                  <td className="py-1.5 text-right tnum">{v.counts.lost}</td>
                  <td className="py-1.5 text-right font-semibold tnum">{v.counts.total}</td>
                  <td className="py-1.5 text-right tnum">
                    {v.conversionRate === null ? '—' : `${v.conversionRate}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <ul className="mt-4 space-y-4">
            {verticals.map((v) => (
              <li key={v.userId}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="font-semibold">{v.name}</span>
                  {/* Direct labels, so the numbers never depend on a hover. */}
                  <span className="text-xs text-[var(--color-text-muted)]">
                    <span className="font-semibold text-[var(--color-text)] tnum">
                      {v.counts.total.toLocaleString('en-IN')}
                    </span>{' '}
                    leads ·{' '}
                    <span className="tnum">
                      {v.conversionRate === null ? '—' : `${v.conversionRate}%`}
                    </span>{' '}
                    converted · {v.teamSize} people
                    {v.idleCount > 0 ? (
                      <span className="font-semibold text-warn-600 dark:text-warn-100">
                        {' '}
                        · {v.idleCount} idle
                      </span>
                    ) : null}
                  </span>
                </div>

                {/*
                  One bar doing both jobs: its length against the widest
                  vertical is the magnitude, its segments are the composition.

                  Drawn as two bars first — a plain one for size and a stacked
                  one beneath for the split — which encoded the same total
                  twice and invited the reader to compare them.
                */}
                <div
                  className="mt-1.5 h-2.5 w-full rounded-full bg-[var(--color-surface-inset)]"
                  role="img"
                  aria-label={`${v.name}: ${v.counts.total} leads — ${STAGES.map(
                    (s) => `${MIS_LEAD_GROUP_LABELS[s.key]} ${v.counts[s.key]}`,
                  ).join(', ')}`}
                >
                  <div
                    className="flex h-full overflow-hidden rounded-full"
                    style={{ width: `${Math.max(3, (v.counts.total / largest) * 100)}%` }}
                  >
                    <Composition counts={v.counts} />
                  </div>
                </div>

                {/* The same four numbers in words, so the breakdown never
                    depends on telling two shades apart. */}
                <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--color-text-muted)]">
                  {STAGES.map((stage) => (
                    <span key={stage.key} className="inline-flex items-center gap-1">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-sm ${
                          stage.textured ? 'stage-textured' : ''
                        }`}
                        style={{ backgroundColor: stage.color }}
                        aria-hidden
                      />
                      {MIS_LEAD_GROUP_LABELS[stage.key]}{' '}
                      <span className="font-semibold text-[var(--color-text)] tnum">
                        {v.counts[stage.key]}
                      </span>
                    </span>
                  ))}
                </p>
              </li>
            ))}
          </ul>

          {/* No legend: every row already names its four numbers beside their
              own swatch, and a legend would say the same thing again further
              from where it is read. */}
        </>
      )}
    </section>
  );
}

/**
 * Blue untouched, orange in progress, green converted, red lost.
 *
 * Chosen by the business, and the same four the lead status badges already
 * use — so a stage reads the same here as it does on a lead. One set serves
 * both themes: every step clears 3:1 against the light surface and the dark
 * one, and all four sit inside each theme's lightness band.
 *
 * The cost, measured rather than guessed: green and red are adjacent in the
 * bar and separate by only ΔE 4.6 under deuteranopia. For the commonest form
 * of colour blindness those two segments look the same, and they are the two
 * a chief executive most needs to tell apart.
 *
 * So the pair does not rely on hue. Every segment's number is written out
 * beside its own swatch, and Lost carries a diagonal hatch as well as its
 * colour — which also survives a black-and-white printout and forced-colours
 * mode. A sequential navy ramp was built first and would have been CVD-safe
 * by construction; this is the deliberate trade of that property for colours
 * the business reads instantly.
 */
const STAGES = [
  { key: 'untouched', color: 'var(--color-stage-1)', textured: false },
  { key: 'inProgress', color: 'var(--color-stage-2)', textured: false },
  { key: 'converted', color: 'var(--color-stage-3)', textured: false },
  // Lost carries a hatch as well as its colour. Green and red are adjacent
  // here and separate by only ΔE 4.6 under deuteranopia, so hue alone cannot
  // be trusted to tell converted from lost — the one pair that matters most.
  { key: 'lost', color: 'var(--color-stage-4)', textured: true },
] as const;

function Composition({ counts }: { counts: MisVerticalSummary['counts'] }) {
  if (counts.total === 0) return null;
  const segments = STAGES.filter((stage) => counts[stage.key] > 0);

  return (
    <>
      {segments.map((stage, index) => (
        <span
          key={stage.key}
          className={stage.textured ? 'stage-textured' : undefined}
          title={`${MIS_LEAD_GROUP_LABELS[stage.key]}: ${counts[stage.key]}`}
          style={{
            width: `${(counts[stage.key] / counts.total) * 100}%`,
            backgroundColor: stage.color,
            // A 2px surface gap between segments, so two adjacent steps of one
            // ramp never read as a single longer one. Not on the last, which
            // would cut the bar short of its own length.
            boxShadow:
              index === segments.length - 1 ? undefined : 'inset -2px 0 0 0 var(--color-surface)',
          }}
        />
      ))}
    </>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={`pb-1.5 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)] ${className}`}
    >
      {children}
    </th>
  );
}
