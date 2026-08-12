'use client';

import { Suspense, useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { LEAD_STATUSES, type LeadSourceItem } from '@sihl-one/contracts';

import { humanise } from '@/lib/format';

/**
 * URL-backed filter bar.
 *
 * Every control writes to the query string and lets the server component
 * re-render. Keeping a parallel copy in React state is what makes filter bars
 * drift out of sync with the results they claim to describe.
 *
 * The Suspense boundary is required, not decorative: `useSearchParams()`
 * suspends, and without a boundary here the route's loading.tsx skeleton is
 * what suspends instead — leaving the entire page stuck on its skeleton with no
 * error anywhere to explain why.
 */
export function LeadFilters({ sources }: { sources: LeadSourceItem[] }) {
  return (
    <Suspense fallback={<div className="card h-[58px] animate-pulse" />}>
      <LeadFiltersInner sources={sources} />
    </Suspense>
  );
}

function LeadFiltersInner({ sources }: { sources: LeadSourceItem[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [search, setSearch] = useState(searchParams.get('q') ?? '');

  // Keep the box in step when the URL changes from elsewhere — a dashboard
  // deep-link, or the browser back button.
  useEffect(() => {
    setSearch(searchParams.get('q') ?? '');
  }, [searchParams]);

  const apply = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') params.delete(key);
      else params.set(key, value);
    }
    // Any filter change invalidates the current page number; staying on page 4
    // of a result set that now has two pages shows an empty screen.
    params.delete('page');
    // Computed URL: typedRoutes cannot check a runtime-built query string.
    startTransition(() => router.push(`${pathname}?${params.toString()}` as Route));
  };

  // Debounced search: firing a request per keystroke would hammer the API and
  // race its own responses.
  useEffect(() => {
    const current = searchParams.get('q') ?? '';
    if (search === current) return;

    const timer = setTimeout(() => apply({ q: search || null }), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const status = searchParams.get('status') ?? '';
  const source = searchParams.get('source') ?? '';
  const overdueOnly = searchParams.get('overdueOnly') === 'true';
  const hotOnly = searchParams.get('minScore') === '70';

  const activeCount = ['q', 'status', 'source', 'priority', 'overdueOnly', 'minScore'].filter(
    (key) => searchParams.get(key),
  ).length;

  return (
    <div className={`card p-3 transition-opacity ${pending ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Name, mobile, email or reference…"
          className="input h-9 min-w-[16rem] flex-1"
          aria-label="Search leads"
        />

        <select
          value={status}
          onChange={(event) => apply({ status: event.target.value || null })}
          className="input h-9 w-auto"
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {LEAD_STATUSES.map((value) => (
            <option key={value} value={value}>
              {humanise(value)}
            </option>
          ))}
        </select>

        <select
          value={source}
          onChange={(event) => apply({ source: event.target.value || null })}
          className="input h-9 w-auto"
          aria-label="Filter by source"
        >
          <option value="">All sources</option>
          {sources.map((source) => (
            <option key={source.code} value={source.code}>
              {source.label}
            </option>
          ))}
        </select>

        <ToggleChip
          active={overdueOnly}
          onClick={() => apply({ overdueOnly: overdueOnly ? null : 'true' })}
        >
          Overdue only
        </ToggleChip>

        <ToggleChip active={hotOnly} onClick={() => apply({ minScore: hotOnly ? null : '70' })}>
          Hot leads
        </ToggleChip>

        {activeCount > 0 ? (
          <button
            type="button"
            onClick={() =>
              startTransition(() => {
                setSearch('');
                router.push(pathname as Route);
              })
            }
            className="btn btn-ghost h-9 text-xs"
          >
            Clear ({activeCount})
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ToggleChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-9 rounded-lg border px-3 text-xs font-semibold transition-colors ${
        active
          ? 'border-teal-500 bg-teal-500 text-white'
          : 'border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]'
      }`}
    >
      {children}
    </button>
  );
}
