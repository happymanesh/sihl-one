'use client';

import { useState } from 'react';
import { formatDateTime, formatRelative, humanise } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';

interface Entry {
  id: string;
  type: string;
  direction: string;
  subject: string;
  body: string | null;
  outcome: string | null;
  occurredAt: string;
  isSystemGenerated: boolean;
  actor: { id: string; fullName: string } | null;
}

const TYPE_TONE: Record<string, 'navy' | 'teal' | 'green' | 'amber' | 'blue' | 'neutral'> = {
  CALL: 'navy',
  MEETING: 'teal',
  VISIT: 'teal',
  WHATSAPP: 'green',
  EMAIL: 'blue',
  SMS: 'blue',
  NOTE: 'neutral',
  STATUS_CHANGE: 'amber',
  ASSIGNMENT: 'amber',
  DOCUMENT: 'neutral',
  SYSTEM: 'neutral',
};

/**
 * Human interactions and system events share one stream — that is what makes it
 * a story of the relationship rather than two half-pictures. System rows are
 * visually quieter so the eye lands on the calls and meetings first.
 */
/** How many entries the inline stream shows before offering the rest. */
const INLINE_LIMIT = 3;

export function Timeline({ entries }: { entries: Entry[] }) {
  const [showAll, setShowAll] = useState(false);

  if (entries.length === 0) {
    return (
      <p className="mt-5 text-sm text-[var(--color-text-muted)]">
        Nothing logged yet. The first call, message or meeting will appear here.
      </p>
    );
  }

  const visible = entries.slice(0, INLINE_LIMIT);
  const hidden = entries.length - visible.length;

  return (
    <>
      <TimelineList entries={visible} />

      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-1 text-sm font-semibold text-teal-600 hover:underline dark:text-teal-300"
        >
          … {hidden} more {hidden === 1 ? 'entry' : 'entries'}
        </button>
      ) : null}

      {showAll ? <TimelineDialog entries={entries} onClose={() => setShowAll(false)} /> : null}
    </>
  );
}

/**
 * The full history, in a table with exact timestamps.
 *
 * A table rather than the stream because this view is for looking something up
 * — "when exactly did we call?" — and a column of times is scannable in a way a
 * vertical story is not.
 */
function TimelineDialog({ entries, onClose }: { entries: Entry[]; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-navy-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="timeline-title"
      onClick={onClose}
    >
      <div
        className="card flex max-h-[80vh] w-full max-w-3xl flex-col p-0"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
          <h2 id="timeline-title" className="font-bold">
            Full history · {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          </h2>
          <button type="button" onClick={onClose} className="btn btn-ghost h-8 px-2 text-xs" autoFocus>
            Close
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] text-left">
              <tr>
                {['When', 'Type', 'Summary', 'Outcome', 'Who'].map((heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className="px-4 py-2 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {entries.map((entry) => (
                <tr key={entry.id}>
                  {/* Exact, not relative: this view exists to answer "when". */}
                  <td className="whitespace-nowrap px-4 py-2 text-xs tnum text-[var(--color-text-muted)]">
                    {formatDateTime(entry.occurredAt)}
                  </td>
                  <td className="px-4 py-2">
                    <Badge tone={TYPE_TONE[entry.type] ?? 'neutral'}>{humanise(entry.type)}</Badge>
                  </td>
                  <td className="px-4 py-2">
                    <span className="font-medium">{entry.subject}</span>
                    {entry.body ? (
                      <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">
                        {entry.body}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-xs text-[var(--color-text-muted)]">
                    {entry.outcome ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-[var(--color-text-muted)]">
                    {entry.actor?.fullName ?? 'System'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TimelineList({ entries }: { entries: Entry[] }) {
  return (
    <ol className="mt-4 space-y-0">
      {entries.map((entry, index) => (
        <li key={entry.id} className="relative flex gap-3 pb-5 last:pb-0">
          {/* Connector, omitted on the final row so the line does not dangle. */}
          {index < entries.length - 1 ? (
            <span
              className="absolute left-[7px] top-5 h-full w-px bg-[var(--color-border)]"
              aria-hidden
            />
          ) : null}

          <span
            className={`relative z-10 mt-1.5 h-[15px] w-[15px] shrink-0 rounded-full border-2 border-[var(--color-surface)] ${
              entry.isSystemGenerated ? 'bg-[var(--color-border-strong)]' : 'bg-teal-500'
            }`}
            aria-hidden
          />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <Badge tone={TYPE_TONE[entry.type] ?? 'neutral'}>{humanise(entry.type)}</Badge>
              <p
                className={`text-sm ${
                  entry.isSystemGenerated
                    ? 'text-[var(--color-text-muted)]'
                    : 'font-semibold text-[var(--color-text)]'
                }`}
              >
                {entry.subject}
              </p>
            </div>

            {entry.body ? (
              <p className="mt-1 whitespace-pre-line text-sm text-[var(--color-text-muted)]">
                {entry.body}
              </p>
            ) : null}

            <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
              <time dateTime={entry.occurredAt} title={formatDateTime(entry.occurredAt)}>
                {formatRelative(entry.occurredAt)}
              </time>
              {entry.actor ? ` · ${entry.actor.fullName}` : ''}
              {entry.outcome ? ` · ${entry.outcome}` : ''}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
