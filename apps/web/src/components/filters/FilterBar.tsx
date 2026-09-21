'use client';

import { Suspense, useState, type ReactNode } from 'react';

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
  collapsible = false,
}: {
  children: ReactNode;
  pending?: boolean;
  activeCount?: number;
  onClear?: () => void;
  /**
   * Fold the controls behind a toggle.
   *
   * Opt-in rather than the default, because this component backs seven screens
   * and most of them carry two or three controls that cost nothing to leave on
   * show. It earns its place where the row has grown long enough to push the
   * results down the page.
   */
  collapsible?: boolean;
}) {
  /*
    Open when something is filtered.

    A filtered view is frequently arrived at rather than chosen — a dashboard
    tile, a link from an event, the back button — and a reader who lands on a
    short list with the controls folded away has no way to see why it is short.
    Collapsed is the right resting state; it is the wrong arrival state.
  */
  const [open, setOpen] = useState(activeCount > 0);

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      {activeCount > 0 && onClear ? (
        <button type="button" onClick={onClear} className="btn btn-ghost h-9 text-xs">
          Clear ({activeCount})
        </button>
      ) : null}
    </div>
  );

  if (!collapsible) {
    return (
      <div className={`card p-3 transition-opacity ${pending ? 'opacity-60' : ''}`}>{controls}</div>
    );
  }

  return (
    <div className={`card p-0 transition-opacity ${pending ? 'opacity-60' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-sm font-semibold"
      >
        <span
          aria-hidden
          className={`inline-block transition-transform ${open ? 'rotate-90' : ''}`}
        >
          ›
        </span>
        Filters
        {activeCount > 0 ? (
          // The count is the whole point of collapsing: it is what tells a
          // reader the list is filtered without making them open anything.
          <span className="rounded-full bg-teal-500 px-2 py-0.5 text-xs font-bold text-white tnum">
            {activeCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="border-t border-[var(--color-border)] px-4 py-3">{controls}</div>
      ) : null}
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
