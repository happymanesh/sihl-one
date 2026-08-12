'use client';

import { Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';

import { formatNumber } from '@/lib/format';

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
}

/**
 * Self-wrapping Suspense boundary.
 *
 * `useSearchParams()` suspends until the client knows the URL. Without a
 * boundary of its own, the nearest ancestor boundary — here, the route's
 * loading.tsx — is the one that suspends, so the *whole page* sits on its
 * skeleton and never reveals content. That failure is silent: no console error,
 * no server error, just a page that never finishes loading.
 *
 * Wrapping here rather than at each call site means a future page cannot
 * reintroduce the bug by forgetting.
 */
export function Pagination(props: PaginationProps) {
  return (
    <Suspense fallback={<div className="h-8" />}>
      <PaginationInner {...props} />
    </Suspense>
  );
}

function PaginationInner({
  page,
  totalPages,
  total,
  pageSize,
}: PaginationProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (totalPages <= 1) return null;

  const goto = (target: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(target));
    // Computed URL: typedRoutes cannot check a runtime-built query string.
    router.push(`${pathname}?${params.toString()}` as Route);
  };

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-3 px-1"
      aria-label="Pagination"
    >
      {/* "Showing 21–40 of 137" rather than a bare page number: it tells the
          user how much is left, which a page count alone does not. */}
      <p className="text-xs text-[var(--color-text-muted)] tnum">
        Showing {formatNumber(from)}–{formatNumber(to)} of {formatNumber(total)}
      </p>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => goto(page - 1)}
          disabled={page <= 1}
          className="btn btn-outline h-8 text-xs"
        >
          Previous
        </button>
        <span className="px-3 text-xs font-semibold tnum">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => goto(page + 1)}
          disabled={page >= totalPages}
          className="btn btn-outline h-8 text-xs"
        >
          Next
        </button>
      </div>
    </nav>
  );
}
