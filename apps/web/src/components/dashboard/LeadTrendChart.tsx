'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface Point {
  date: string;
  created: number;
  converted: number;
}

/**
 * Two series, not a stack.
 *
 * Converted is a subset of created, so stacking them would double-count and
 * make the top edge meaningless. Overlaying with a filled area for created and
 * a stronger line for converted keeps the relationship readable: the gap
 * between the two *is* the funnel loss.
 */
export function LeadTrendChart({ data }: { data: Point[] }) {
  const formatted = data.map((point) => ({
    ...point,
    label: new Date(point.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
  }));

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center gap-4 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-navy-500" aria-hidden />
          Created
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-teal-500" aria-hidden />
          Converted
        </span>
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={formatted} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id="created-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0a5281" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#0a5281" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="converted-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1d8f6a" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#1d8f6a" stopOpacity={0.03} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: 'var(--color-text-subtle)' }}
              tickLine={false}
              axisLine={false}
              // 30 labels will not fit on a phone; showing every fifth keeps the
              // axis legible without dropping data points from the series.
              interval={4}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--color-text-subtle)' }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={38}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                fontSize: 12,
                color: 'var(--color-text)',
              }}
              labelStyle={{ fontWeight: 700, color: 'var(--color-text)' }}
            />
            <Area
              type="monotone"
              dataKey="created"
              name="Created"
              stroke="#0a5281"
              strokeWidth={2}
              fill="url(#created-fill)"
            />
            <Area
              type="monotone"
              dataKey="converted"
              name="Converted"
              stroke="#1d8f6a"
              strokeWidth={2}
              fill="url(#converted-fill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
