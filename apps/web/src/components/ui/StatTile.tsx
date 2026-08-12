import type { ReactNode } from 'react';

/**
 * A single headline metric.
 *
 * `delta` is rendered with an explicit arrow and the word "vs previous 30 days"
 * because a bare "+12%" is ambiguous about both direction and baseline — and a
 * metric nobody can interpret gets ignored.
 *
 * `invertDelta` exists because "up" is not always good: overdue follow-ups
 * rising is bad, conversions rising is good, and the colour must reflect the
 * business meaning rather than the sign of the number.
 */
export function StatTile({
  label,
  value,
  delta,
  deltaSuffix = '%',
  invertDelta = false,
  hint,
  href,
  icon,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  delta?: number | null;
  deltaSuffix?: string;
  invertDelta?: boolean;
  hint?: string;
  href?: string;
  icon?: ReactNode;
  tone?: 'default' | 'warning' | 'danger';
}) {
  const isGood = delta === null || delta === undefined ? null : invertDelta ? delta <= 0 : delta >= 0;

  const toneClasses =
    tone === 'danger'
      ? 'border-danger-500/40'
      : tone === 'warning'
        ? 'border-warn-500/40'
        : '';

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          {label}
        </p>
        {icon ? <span className="text-[var(--color-text-subtle)]">{icon}</span> : null}
      </div>

      <p className="mt-2 text-2xl font-bold tnum">{value}</p>

      {delta !== null && delta !== undefined ? (
        <p
          className={`mt-1 text-xs font-semibold ${
            isGood ? 'text-teal-600 dark:text-teal-300' : 'text-danger-500'
          }`}
        >
          <span aria-hidden>{delta >= 0 ? '▲' : '▼'}</span>{' '}
          {Math.abs(delta)}
          {deltaSuffix}{' '}
          <span className="font-normal text-[var(--color-text-subtle)]">vs previous 30 days</span>
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-[var(--color-text-subtle)]">{hint}</p>
      ) : null}
    </>
  );

  const className = `card p-4 ${toneClasses} ${href ? 'transition-shadow hover:shadow-raised' : ''}`;

  return href ? (
    <a href={href} className={`${className} block`}>
      {content}
    </a>
  ) : (
    <div className={className}>{content}</div>
  );
}
