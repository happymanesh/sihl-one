'use client';

import { Suspense, type ReactNode } from 'react';

/**
 * The card that holds a screen's filter controls.
 *
 * The Suspense boundary is required, not decorative. Everything inside reads
 * `useSearchParams()`, which suspends; without a boundary here the nearest one
 * upstream suspends instead and the whole route sits on its fallback with
 * nothing in the console to explain it.
 */
export function FilterBar({
  children,
  pending = false,
  activeCount = 0,
  onClear,
}: {
  children: ReactNode;
  pending?: boolean;
  activeCount?: number;
  onClear?: () => void;
}) {
  return (
    <div className={`card p-3 transition-opacity ${pending ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        {children}
        {activeCount > 0 && onClear ? (
          <button type="button" onClick={onClear} className="btn btn-ghost h-9 text-xs">
            Clear ({activeCount})
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Wraps a filter bar in the boundary its `useSearchParams()` calls require. */
export function FilterBarBoundary({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="card h-[58px] animate-pulse" />}>{children}</Suspense>;
}

export function ToggleChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
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
