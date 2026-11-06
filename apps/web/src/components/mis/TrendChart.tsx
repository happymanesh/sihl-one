'use client';

import { useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MisTrendPoint } from '@sihl-one/contracts';

/**
 * Leads created against leads converted, over time.
 *
 * Two series, never stacked. Converted counts conversions that *happened* in
 * the bucket, whoever created the lead and whenever — so it is not a subset of
 * this bucket's created, and stacking would add two numbers that do not belong
 * to the same population. Overlaid, the reader compares two heights, which is
 * the only honest comparison available.
 *
 * One axis. Rate belongs in its own chart: a second y-scale would let the two
 * lines be made to cross wherever the scales were chosen to make them.
 *
 * Colour comes from `--color-chart-1` and `--color-chart-2`, which take their
 * own steps in dark mode — both pairs validated for colour-vision separation.
 * The table view below is not decoration: it is what a reader who cannot
 * separate the two hues uses instead, and what gets pasted into a board pack.
 */
export function TrendChart({
  title,
  caption,
  data,
}: {
  title: string;
  caption: string;
  data: MisTrendPoint[];
}) {
  const [asTable, setAsTable] = useState(false);
  const empty = data.every((point) => point.created === 0 && point.converted === 0);

  return (
    <section className="card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold">{title}</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{caption}</p>
        </div>
        <button
          type="button"
          onClick={() => setAsTable((showing) => !showing)}
          className="text-xs font-semibold text-teal-600 underline underline-offset-2 dark:text-teal-300"
        >
          {asTable ? 'View as chart' : 'View as table'}
        </button>
      </div>

      {/* Identity is never colour alone — the legend names both series, and
          the table carries them as words. */}
      <div className="mt-3 flex items-center gap-4 text-xs">
        <Key color="var(--color-chart-1)" label="Created" />
        <Key color="var(--color-chart-2)" label="Converted" />
      </div>

      {empty ? (
        <p className="mt-6 pb-4 text-center text-sm text-[var(--color-text-muted)]">
          Nothing recorded in this period.
        </p>
      ) : asTable ? (
        <div className="mt-3 max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[var(--color-surface)] text-left">
              <tr>
                <Th>Period</Th>
                <Th className="text-right">Created</Th>
                <Th className="text-right">Converted</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {data.map((point) => (
                <tr key={point.period}>
                  <td className="py-1.5">{point.label}</td>
                  <td className="py-1.5 text-right tnum">{point.created}</td>
                  <td className="py-1.5 text-right tnum">{point.converted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-3 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id={`fill-${title.replace(/\W/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0.02} />
                </linearGradient>
              </defs>

              {/* Recessive: the data is the subject, the grid is scaffolding. */}
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                tickLine={false}
                axisLine={{ stroke: 'var(--color-border)' }}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                width={44}
              />
              <Tooltip
                cursor={{ stroke: 'var(--color-border-strong)', strokeWidth: 1 }}
                contentStyle={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  fontSize: 12,
                  color: 'var(--color-text)',
                }}
                labelStyle={{ color: 'var(--color-text-muted)', fontSize: 11 }}
              />

              <Area
                type="monotone"
                dataKey="created"
                name="Created"
                stroke="var(--color-chart-1)"
                strokeWidth={2}
                fill={`url(#fill-${title.replace(/\W/g, '')})`}
              />
              <Line
                type="monotone"
                dataKey="converted"
                name="Converted"
                stroke="var(--color-chart-2)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

function Key({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[var(--color-text-muted)]">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} aria-hidden />
      {label}
    </span>
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
