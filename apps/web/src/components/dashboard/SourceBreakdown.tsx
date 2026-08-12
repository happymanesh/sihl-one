import { humanise } from '@/lib/format';

/**
 * Ranked bars rather than a pie.
 *
 * With seven or more slices a pie stops being comparable — nobody can tell 14%
 * from 16% by angle. A sorted bar list answers the actual question ("which
 * source brings us the most") at a glance and stays readable on a phone.
 *
 * Rendered as a server component: it is plain markup, so shipping a chart
 * library to the browser for it would be waste.
 */
export function SourceBreakdown({ data }: { data: Array<{ source: string; count: number }> }) {
  const total = data.reduce((sum, row) => sum + row.count, 0);

  if (total === 0) {
    return (
      <p className="mt-5 text-sm text-[var(--color-text-muted)]">
        No leads recorded yet, so there is nothing to attribute.
      </p>
    );
  }

  const max = Math.max(...data.map((row) => row.count));

  return (
    <ul className="mt-4 space-y-3">
      {data.slice(0, 7).map((row) => {
        const share = Math.round((row.count / total) * 100);
        return (
          <li key={row.source}>
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-semibold">{humanise(row.source)}</span>
              <span className="text-[var(--color-text-subtle)] tnum">
                {row.count} · {share}%
              </span>
            </div>
            <span className="mt-1 block h-2 overflow-hidden rounded-full bg-[var(--color-surface-inset)]">
              <span
                className="block h-full rounded-full bg-teal-500"
                style={{ width: `${(row.count / max) * 100}%` }}
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
