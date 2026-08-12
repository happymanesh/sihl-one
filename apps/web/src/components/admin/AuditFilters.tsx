'use client';

import { Suspense, useRef, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { AUDIT_ACTIONS, AUDITABLE_RESOURCES } from '@sihl-one/contracts';

import { humanise } from '@/lib/format';

/**
 * Audit filters.
 *
 * Not the shared `FilterBar`: this one needs a date range and a security
 * toggle, and the toggle is the reason most people open the screen at all.
 * Bending the shared component into supporting both would have made it worse
 * for the two screens that only want a search box and two selects.
 */
export function AuditFilters() {
  return (
    <Suspense fallback={<div className="card h-[58px] animate-pulse" />}>
      <AuditFiltersInner />
    </Suspense>
  );
}

function AuditFiltersInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const searchTimer = useRef<number | undefined>(undefined);

  const apply = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') params.delete(key);
      else params.set(key, value);
    }
    params.delete('page');
    // Computed URL: typedRoutes cannot check a runtime-built query string.
    startTransition(() => router.push(`${pathname}?${params.toString()}` as Route));
  };

  const securityOnly = searchParams.get('securityOnly') === 'true';
  const activeCount = ['q', 'action', 'resource', 'securityOnly', 'from', 'to'].filter((key) =>
    searchParams.get(key),
  ).length;

  return (
    <div className={`card p-3 transition-opacity ${pending ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          defaultValue={searchParams.get('q') ?? ''}
          onChange={(event) => {
            const value = event.target.value;
            // Uncontrolled with a debounce: the trail is the one screen where
            // someone pastes a 32-character trace id, and a controlled input
            // re-rendering the whole list per keystroke makes that miserable.
            window.clearTimeout(searchTimer.current);
            searchTimer.current = window.setTimeout(() => apply({ q: value || null }), 400);
          }}
          placeholder="Person, resource, record id or trace id…"
          className="input h-9 min-w-[18rem] flex-1"
          aria-label="Search the audit trail"
        />

        <select
          value={searchParams.get('action') ?? ''}
          onChange={(event) => apply({ action: event.target.value || null })}
          className="input h-9 w-auto"
          aria-label="Filter by action"
        >
          <option value="">All actions</option>
          {AUDIT_ACTIONS.map((action) => (
            <option key={action} value={action}>
              {humanise(action)}
            </option>
          ))}
        </select>

        <select
          value={searchParams.get('resource') ?? ''}
          onChange={(event) => apply({ resource: event.target.value || null })}
          className="input h-9 w-auto"
          aria-label="Filter by resource"
        >
          <option value="">All resources</option>
          {AUDITABLE_RESOURCES.map((resource) => (
            <option key={resource} value={resource}>
              {humanise(resource.replace(/\./g, ' '))}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={searchParams.get('from') ?? ''}
          onChange={(event) => apply({ from: event.target.value || null })}
          className="input h-9 w-auto"
          aria-label="From date"
        />
        <input
          type="date"
          value={searchParams.get('to') ?? ''}
          onChange={(event) => apply({ to: event.target.value || null })}
          className="input h-9 w-auto"
          aria-label="To date"
        />

        <button
          type="button"
          onClick={() => apply({ securityOnly: securityOnly ? null : 'true' })}
          aria-pressed={securityOnly}
          className={`h-9 rounded-lg border px-3 text-xs font-semibold transition-colors ${
            securityOnly
              ? 'border-danger-500 bg-danger-500 text-white'
              : 'border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]'
          }`}
        >
          Security only
        </button>

        {activeCount > 0 ? (
          <button
            type="button"
            onClick={() => startTransition(() => router.push(pathname as Route))}
            className="btn btn-ghost h-9 text-xs"
          >
            Clear ({activeCount})
          </button>
        ) : null}
      </div>
    </div>
  );
}
