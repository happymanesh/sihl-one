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
      const next = new URLSearchParams(params.toString());
      if (draft) next.set('q', draft);
      else next.delete('q');
      // A new search starts at the top. Staying on page three of a narrower
      // result is how a list appears to be empty.
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
