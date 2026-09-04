'use client';

import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

/**
 * The period control, and the download.
 *
 * Presets first, because the question a sales head actually asks is "this
 * month" or "last quarter" rather than a pair of dates. The explicit dates stay
 * for the reviews that need an exact window.
 */
const PRESETS = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
] as const;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function RangePicker({
  from,
  to,
  exportHref,
}: {
  from?: string;
  to?: string;
  exportHref: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [downloading, setDownloading] = useState(false);

  const apply = (nextFrom: string, nextTo: string) => {
    const next = new URLSearchParams(params.toString());
    next.set('from', nextFrom);
    next.set('to', nextTo);
    router.push(`/reports?${next.toString()}` as Route);
  };

  const preset = (days: number) => {
    const end = new Date();
    apply(isoDay(new Date(end.getTime() - days * 86_400_000)), isoDay(end));
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex overflow-hidden rounded-md border border-[var(--color-border)]">
        {PRESETS.map((option) => (
          <button
            key={option.days}
            type="button"
            onClick={() => preset(option.days)}
            className="border-r border-[var(--color-border)] px-3 py-1.5 text-xs last:border-r-0 hover:bg-[var(--color-surface-inset)]"
          >
            {option.label}
          </button>
        ))}
      </div>

      <input
        type="date"
        aria-label="From"
        defaultValue={from}
        max={to}
        onChange={(event) => event.target.value && apply(event.target.value, to ?? isoDay(new Date()))}
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs"
      />
      <input
        type="date"
        aria-label="To"
        defaultValue={to}
        min={from}
        onChange={(event) =>
          event.target.value &&
          apply(from ?? isoDay(new Date(Date.now() - 30 * 86_400_000)), event.target.value)
        }
        className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs"
      />

      {/*
        A plain link, not a fetch-and-blob. The browser handles the download
        natively, which keeps the workbook out of JavaScript memory — it can run
        to several megabytes — and means a failure surfaces as an ordinary
        error page rather than a button that silently does nothing.
      */}
      <a
        href={exportHref}
        onClick={() => {
          setDownloading(true);
          window.setTimeout(() => setDownloading(false), 4000);
        }}
        className="btn-primary px-3 py-1.5 text-xs"
      >
        {downloading ? 'Preparing…' : 'Export to Excel'}
      </a>
    </div>
  );
}
