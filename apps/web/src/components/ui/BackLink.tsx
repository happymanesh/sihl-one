'use client';

import { useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';

/** How long to let `router.back()` prove it went somewhere. */
const SETTLE_MS = 120;

/**
 * Back to wherever you came from.
 *
 * A record is reached from several places — a lead from Tasks, Pipeline,
 * Visits, Duplicates or search — so a fixed "← Tasks" would be a lie from
 * most of them. This follows the browser's own history instead, which is the
 * only thing that knows the real answer.
 *
 * It does not replace the breadcrumb beside it. The breadcrumb says where a
 * record *lives*; this says where *you* were. Sending somebody who came from
 * a filtered task list to the full leads list, which is what the breadcrumb
 * does, costs them both their place and their filter.
 *
 * The hard part is knowing whether there is anywhere to go back to. A pasted
 * link, a new tab or a page opened from a notification has no in-app history,
 * and "back" there either does nothing or leaves the application.
 * `window.history.length` does not answer it — a fresh tab that has navigated
 * once already reports 2 — so this asks the only question that is reliable:
 * it goes back, and checks shortly afterwards whether the address actually
 * changed. If it did not, there was nothing behind us, and the fallback is
 * used instead.
 */
export function BackLink({
  fallback,
  label = 'Back',
}: {
  /** Where to go when there is nothing to go back to. */
  fallback: Route;
  label?: string;
}) {
  const router = useRouter();
  const navigating = useRef(false);

  const goBack = () => {
    // Guard against a double click firing two history pops.
    if (navigating.current) return;
    navigating.current = true;

    const before = window.location.href;
    router.back();

    window.setTimeout(() => {
      navigating.current = false;
      if (window.location.href === before) router.push(fallback);
    }, SETTLE_MS);
  };

  return (
    <button
      type="button"
      onClick={goBack}
      className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:underline"
    >
      <span aria-hidden>←</span>
      {label}
    </button>
  );
}
