import type { Scorecard } from '@sihl-one/contracts';

import { Badge } from '@/components/ui/Badge';
import { apiFetch } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { formatCompactCurrency, formatNumber, humanise, ordinal } from '@/lib/format';

export const metadata = { title: 'My performance' };

const BAND_TONE: Record<string, 'teal' | 'green' | 'blue' | 'amber'> = {
  EXCEPTIONAL: 'green',
  STRONG: 'teal',
  ON_TRACK: 'blue',
  DEVELOPING: 'amber',
};

function Meter({ score }: { score: number }) {
  return (
    <span className="block h-2 overflow-hidden rounded-full bg-[var(--color-surface-inset)]">
      <span
        className={`block h-full rounded-full ${
          score >= 70 ? 'bg-teal-500' : score >= 45 ? 'bg-navy-500' : 'bg-warn-500'
        }`}
        style={{ width: `${Math.max(2, score)}%` }}
      />
    </span>
  );
}

export default async function PerformancePage() {
  await requireUser();
  const card = await apiFetch<Scorecard>('/performance/me?days=90');
  const { rating, nudges, target, standing } = card;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header>
        <h1 className="text-2xl font-bold">My performance</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">{card.period.label}</p>
      </header>

      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <p className="text-4xl font-bold tnum">{rating.overall}</p>
              <Badge tone={BAND_TONE[rating.band] ?? 'blue'}>{humanise(rating.band)}</Badge>
            </div>
            <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
              Confidence: {humanise(rating.confidence)} · {rating.leadsAssessed} leads assessed
            </p>
          </div>

          <div className="text-right">
            <p className="text-xs text-[var(--color-text-muted)]">Versus expected</p>
            <p className="text-2xl font-bold tnum">{rating.outcomeIndex}×</p>
            <p className="text-xs text-[var(--color-text-subtle)]">
              {rating.actualConversions} converted vs {rating.expectedConversions} expected
            </p>
          </div>
        </div>

        {/*
          The explanation is not decoration. A score someone cannot interrogate
          gets dismissed by a sales floor — correctly, since it is being read as
          a judgement of their work.
        */}
        <ul className="mt-4 space-y-1.5 border-t border-[var(--color-border)] pt-4 text-sm text-[var(--color-text-muted)]">
          {rating.explanation.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>

        <p className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
          Measured against what your own leads should produce, not against the company average —
          so converting cold leads counts for more than converting warm ones.
        </p>
      </section>

      {target ? (
        <section className="card p-5">
          <h2 className="font-bold">Target</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-[var(--color-text-muted)]">Business value</p>
              <p className="mt-0.5 text-xl font-bold tnum">
                {formatCompactCurrency(target.achievedValue)}
              </p>
              <p className="text-xs text-[var(--color-text-subtle)]">
                of {formatCompactCurrency(target.valueTarget)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--color-text-muted)]">Conversions</p>
              <p className="mt-0.5 text-xl font-bold tnum">
                {formatNumber(target.achievedConversions)}
              </p>
              <p className="text-xs text-[var(--color-text-subtle)]">
                of {target.conversionTarget ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--color-text-muted)]">Attainment</p>
              <p className="mt-0.5 text-xl font-bold tnum">{rating.targetAttainment ?? '—'}%</p>
              {/* Pacing, not raw attainment. Comparing to 100% halfway through a
                  quarter tells someone on track that they are behind. */}
              <p className="text-xs text-[var(--color-text-subtle)]">
                {target.expectedPacePercent}% through the period
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="card p-5">
        <h2 className="font-bold">Your habits</h2>
        <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
          Scored separately from results — this is the part you control.
        </p>
        <ul className="mt-4 space-y-3">
          {rating.behaviourMetrics.map((metric) => (
            <li key={metric.code}>
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-semibold">{metric.label}</span>
                <span className="text-xs text-[var(--color-text-muted)]">
                  {metric.value} · target {metric.target.toLowerCase()}
                </span>
              </div>
              <div className="mt-1">
                <Meter score={metric.score} />
              </div>
            </li>
          ))}
        </ul>
      </section>

      {nudges.length > 0 ? (
        <section className="card p-5">
          <h2 className="font-bold">What to do next</h2>
          <ul className="mt-3 space-y-3">
            {nudges.map((nudge) => (
              <li
                key={nudge.code}
                className={`rounded-lg border-l-[3px] bg-[var(--color-surface-muted)] py-2.5 pl-3 pr-2 ${
                  nudge.priority === 'HIGH'
                    ? 'border-danger-500'
                    : nudge.priority === 'MEDIUM'
                      ? 'border-warn-500'
                      : 'border-teal-500'
                }`}
              >
                <p className="text-sm font-bold">{nudge.title}</p>
                <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{nudge.detail}</p>
                <p className="mt-1.5 text-sm">{nudge.action}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {standing.peersAssessed > 0 ? (
        <section className="card p-5">
          <h2 className="font-bold">Where you stand</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-[var(--color-text-muted)]">Your percentile</p>
              <p className="mt-0.5 text-xl font-bold tnum">
                {standing.percentile === null ? '—' : ordinal(standing.percentile)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--color-text-muted)]">Team median</p>
              <p className="mt-0.5 text-xl font-bold tnum">{standing.teamMedianOverall ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--color-text-muted)]">Top performer</p>
              <p className="mt-0.5 text-xl font-bold tnum">{standing.topPerformerOverall ?? '—'}</p>
              {standing.topPerformerOverall !== null ? (
                <p className="text-xs text-[var(--color-text-subtle)]">
                  {Math.max(0, standing.topPerformerOverall - rating.overall)} points ahead of you
                </p>
              ) : null}
            </div>
          </div>
          {/* A band and a gap, never a ranked list of names. */}
          <p className="mt-3 text-xs text-[var(--color-text-subtle)]">
            Compared against {standing.peersAssessed} colleagues. Individual scores are private.
          </p>
        </section>
      ) : null}
    </div>
  );
}
