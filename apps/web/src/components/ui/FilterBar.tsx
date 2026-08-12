'use client';

import { Suspense, useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';

export interface FilterSelect {
  /** Query-string key this control writes to. */
  name: string;
  /** Shown as the "all" option and as the aria-label. */
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
}

interface Props {
  searchPlaceholder?: string;
  searchLabel: string;
  selects?: readonly FilterSelect[];
  /** Extra query keys that count toward the "Clear (n)" badge. */
  extraKeys?: readonly string[];
}

/**
 * URL-backed filter bar.
 *
 * Every control writes to the query string and lets the server component
 * re-render. Keeping a parallel copy in React state is what makes a filter bar
 * drift out of sync with the results it claims to describe.
 *
 * The Suspense boundary is required, not decorative: `useSearchParams()`
 * suspends, and without a boundary here the route's loading.tsx skeleton is
 * what suspends instead — leaving the whole page stuck on its skeleton with no
 * error anywhere to explain why.
 */
export function FilterBar(props: Props) {
  return (
    <Suspense fallback={<div className="card h-[58px] animate-pulse" />}>
      <FilterBarInner {...props} />
    </Suspense>
  );
}

function FilterBarInner({ searchPlaceholder, searchLabel, selects = [], extraKeys = [] }: Props) {
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

  const activeCount = ['q', ...selects.map((select) => select.name), ...extraKeys].filter((key) =>
    searchParams.get(key),
  ).length;

  return (
    <div className={`card p-3 transition-opacity ${pending ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={searchPlaceholder}
          className="input h-9 min-w-[16rem] flex-1"
          aria-label={searchLabel}
        />

        {selects.map((select) => (
          <select
            key={select.name}
            value={searchParams.get(select.name) ?? ''}
            onChange={(event) => apply({ [select.name]: event.target.value || null })}
            className="input h-9 w-auto"
            aria-label={select.label}
          >
            <option value="">{select.label}</option>
            {select.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ))}

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
