'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';

/**
 * Free-text search over the visit list.
 *
 * Written to the URL rather than held in state, so a search is a link
 * somebody can send, a refresh keeps it, and the back button steps out of it
 * instead of leaving the page. Debounced, so a four-letter name is one
 * request and not four.
 */
export function VisitSearch() {
  const router = useRouter();
  const params = useSearchParams();
  const [draft, setDraft] = useState(params.get('q') ?? '');

  useEffect(() => {
    const timer = setTimeout(() => {
      /*
        Nothing is rewritten unless the search itself changed.

        This effect runs on mount too, and dropping `page` before comparing
        meant that merely arriving on /visits?page=2 rewrote the address to
        /visits — as a `replace`, so the history entry for page 2 was
        overwritten and Back from a lead returned to page 1.
      */
      if ((params.get('q') ?? '') === draft) return;

      const next = new URLSearchParams(params.toString());
      if (draft) next.set('q', draft);
      else next.delete('q');
      // Only once the search changed: a new one starts at the top, because
      // staying on page three of a narrower result looks like an empty list.
      next.delete('page');

      const query = next.toString();
      if (query === params.toString()) return;
      router.replace(`/visits${query ? `?${query}` : ''}` as Route, { scroll: false });
    }, 350);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  return (
    <input
      type="search"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      placeholder="Search client, reference, purpose or rep"
      aria-label="Search visits"
      className="input h-9 w-full sm:max-w-xs"
    />
  );
}
