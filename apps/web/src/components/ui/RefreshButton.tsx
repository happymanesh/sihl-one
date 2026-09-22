'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Icon } from '@/components/shell/Icon';

/**
 * Re-fetch this screen's server data without a full page load.
 *
 * `router.refresh()` rather than `location.reload()`: the first re-runs the
 * server components and swaps in the new payload, keeping scroll position and
 * any client state on the page. A reload throws all of that away and costs a
 * fresh download of the whole app — on a branch connection, for a page somebody
 * is going to refresh every few minutes while an event runs, that difference is
 * the whole point.
 *
 * The pending state matters more than it looks. A refresh that changes nothing
 * visible — because nothing changed — is indistinguishable from a dead button,
 * so the control has to say it did something even when the answer is the same.
 */
export function RefreshButton({ label = 'Refresh' }: { label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      disabled={pending}
      className="btn btn-outline"
      aria-label={label}
      title="Reload the figures on this page"
    >
      <Icon
        name="refresh"
        size={16}
        className={pending ? 'animate-spin motion-reduce:animate-none' : undefined}
      />
      {pending ? 'Refreshing…' : label}
    </button>
  );
}
