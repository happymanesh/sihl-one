import Link from 'next/link';
import type { Route } from 'next';

import type { LeadCursor } from '@/lib/lead-list';
import { leadHref } from '@/lib/lead-list';
import { formatNumber } from '@/lib/format';

/**
 * Next lead, in the order of the list this one was opened from.
 *
 * For working a list rather than looking a lead up: a rep clearing today's
 * follow-ups, a manager reading down a filtered slice. Without it each lead
 * costs a round trip back to the list, and on the second page that also costs
 * finding the row again.
 *
 * The position is shown beside the button because the button alone does not say
 * how much is left — and "4 of 166" is also what tells the reader the filter
 * they set is the one being walked.
 */
export function LeadCursorNav({ cursor }: { cursor: LeadCursor }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-[var(--color-text-muted)] tnum">
        {formatNumber(cursor.position)} of {formatNumber(cursor.total)}
      </span>
      {cursor.next ? (
        <Link
          href={leadHref(cursor.next.id, cursor.next.listQuery) as Route}
          className="btn btn-outline"
          // Named, so the reader knows where Next goes before taking it — and
          // so two clicks in a row are distinguishable from one that failed.
          title={`Next: ${cursor.next.fullName}`}
        >
          Next lead
          <span aria-hidden>→</span>
        </Link>
      ) : (
        <span className="text-xs font-semibold text-[var(--color-text-subtle)]">
          Last in this list
        </span>
      )}
    </div>
  );
}
