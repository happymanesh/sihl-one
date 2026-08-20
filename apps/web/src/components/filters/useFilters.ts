'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import type { Route } from 'next';

/**
 * URL-backed filter state, shared by every list screen.
 *
 * Filters live in the query string rather than in component state so a filtered
 * view is shareable, bookmarkable and survives a refresh — and so a dashboard
 * tile can deep-link straight into the slice it counted.
 *
 * Callers must be inside a Suspense boundary: `useSearchParams()` suspends, and
 * without a local boundary the nearest one upstream suspends instead, which
 * leaves the whole route sitting on its fallback with nothing to explain why.
 */
export function useFilters(ownedKeys: readonly string[]) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  /** Set or clear parameters. `null` removes. Arrays become repeated keys. */
  const apply = (updates: Record<string, string | string[] | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      params.delete(key);
      if (value === null || value === '') continue;
      if (Array.isArray(value)) for (const item of value) params.append(key, item);
      else params.set(key, value);
    }
    // Any filter change invalidates the page number: staying on page 4 of a
    // result set that now has two pages shows an empty screen.
    params.delete('page');
    // Computed URL — typedRoutes cannot check a runtime-built query string.
    startTransition(() => router.push(`${pathname}?${params.toString()}` as Route));
  };

  const clear = () => startTransition(() => router.push(pathname as Route));

  const activeCount = ownedKeys.filter((key) => searchParams.get(key)).length;

  return {
    searchParams,
    apply,
    clear,
    pending,
    activeCount,
    /** All values for a repeated key, for multi-selects. */
    values: (key: string) => searchParams.getAll(key),
  };
}
