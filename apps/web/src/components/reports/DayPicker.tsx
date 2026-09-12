'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

/**
 * The day being reported on.
 *
 * Previous and next buttons rather than only a date field: a manager reading
 * this walks backwards through the week, and typing a date to do that is three
 * interactions where one will do.
 *
 * The next button stops at today. There is nothing to see in tomorrow, and a
 * page of empty rows dated ahead reads as a fault rather than as an empty day.
 *
 * `today` arrives as a prop rather than being read from the clock here. The
 * boundary is the IST day, not the browser's, so the server is the only place
 * that knows it — and reading a clock during render is impure besides.
 */
export function DayPicker({ date, today }: { date: string; today: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const go = (next: string) =>
    startTransition(() => router.push(`/reports/daily?date=${next}` as Route));

  const shift = (days: number) => {
    const moved = new Date(`${date}T12:00:00Z`);
    moved.setUTCDate(moved.getUTCDate() + days);
    const next = moved.toISOString().slice(0, 10);
    if (next > today) return;
    go(next);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => shift(-1)}
        disabled={pending}
        className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--color-surface-inset)] disabled:opacity-60"
      >
        ← Previous day
      </button>
      <input
        type="date"
        value={date}
        max={today}
        onChange={(event) => event.target.value && go(event.target.value)}
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs"
        aria-label="Date"
      />
      <button
        type="button"
        onClick={() => shift(1)}
        disabled={pending || date >= today}
        className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs font-semibold hover:bg-[var(--color-surface-inset)] disabled:opacity-40"
      >
        Next day →
      </button>
    </div>
  );
}
