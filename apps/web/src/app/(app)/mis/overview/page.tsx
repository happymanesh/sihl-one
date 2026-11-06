import { redirect } from 'next/navigation';
import type { Route } from 'next';
import type { MisHeadline, MisOverview } from '@sihl-one/contracts';

import { Icon } from '@/components/shell/Icon';
import { TrendChart } from '@/components/mis/TrendChart';
import { VerticalBars } from '@/components/mis/VerticalBars';
import { apiFetch } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';
import { formatDateCompact } from '@/lib/format';

export const metadata = { title: 'CEO overview' };

export default async function MisOverviewPage() {
  const user = await requireUser();
  if (!can(user, 'mis:read')) redirect('/dashboard');

  const overview = await apiFetch<MisOverview>('/mis/overview');

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">CEO overview</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {overview.periodLabel} against the month before · as on{' '}
            {formatDateCompact(overview.asOn)}
          </p>
        </div>
        <a href={'/mis/team' as Route} className="btn btn-outline">
          <Icon name="users" size={16} />
          Team performance
        </a>
      </header>

      {/* Four numbers before any chart. A single value is read faster as a
          number than as a plot, and these are the four the month turns on. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Headline label="Leads created" headline={overview.leadsCreated} />
        <Headline label="Converted" headline={overview.converted} />
        <RateTile rate={overview.conversionRate} />
        <Headline
          label={`Idle ${overview.idleAfterDays}+ days`}
          headline={overview.idlePeople}
          suffix=" people"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <TrendChart
          title="Week on week"
          caption="Calendar weeks, Monday to Sunday"
          data={overview.weekly}
        />
        <TrendChart title="Month on month" caption="Calendar months" data={overview.monthly} />
      </div>

      <VerticalBars verticals={overview.verticals} />
    </div>
  );
}

/**
 * A headline number and its movement.
 *
 * The arrow and the word both appear, because a coloured triangle alone says
 * nothing to a reader who cannot see the colour — and "better" is carried
 * from the API rather than inferred from the sign, since a rise in idle
 * people is bad news and a rise in everything else is good.
 */
function Headline({
  label,
  headline,
  suffix = '',
}: {
  label: string;
  headline: MisHeadline;
  suffix?: string;
}) {
  return (
    <div className="card">
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </p>
      <p className="mt-1 text-3xl font-bold tnum">
        {headline.value.toLocaleString('en-IN')}
        {suffix ? <span className="text-base font-semibold">{suffix}</span> : null}
      </p>
      {headline.changePercent === null ? (
        <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
          No comparable figure for the month before
        </p>
      ) : (
        <p
          className={`mt-1 text-xs font-semibold ${
            headline.better === null
              ? 'text-[var(--color-text-muted)]'
              : headline.better
                ? 'text-brand-green-700 dark:text-brand-green-400'
                : 'text-danger-600 dark:text-danger-500'
          }`}
        >
          <span aria-hidden>{headline.changePercent >= 0 ? '▲' : '▼'}</span>{' '}
          {Math.abs(headline.changePercent)}% {headline.changePercent >= 0 ? 'higher' : 'lower'}{' '}
          than last month
        </p>
      )}
    </div>
  );
}

function RateTile({ rate }: { rate: MisOverview['conversionRate'] }) {
  return (
    <div className="card">
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]">
        Conversion rate
      </p>
      <p className="mt-1 text-3xl font-bold tnum">{rate.value === null ? '—' : `${rate.value}%`}</p>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
        {rate.previous === null ? (
          'No comparable figure for the month before'
        ) : (
          <>
            {/* Percentage points, not a percentage of a percentage — the
                difference people get wrong when a rate moves. */}
            <span
              className={
                rate.better === null
                  ? ''
                  : rate.better
                    ? 'font-semibold text-brand-green-700 dark:text-brand-green-400'
                    : 'font-semibold text-danger-600 dark:text-danger-500'
              }
            >
              {rate.value !== null
                ? `${rate.value >= rate.previous ? '▲' : '▼'} ${Math.abs(
                    Math.round((rate.value - rate.previous) * 10) / 10,
                  )} points`
                : '—'}
            </span>{' '}
            against {rate.previous}% last month
          </>
        )}
      </p>
    </div>
  );
}
