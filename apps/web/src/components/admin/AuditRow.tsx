'use client';

import { useState } from 'react';
import type { AuditEntryView } from '@sihl-one/contracts';

import { Badge } from '@/components/ui/Badge';
import { formatDateTime, formatRelative, humanise } from '@/lib/format';

const ACTION_TONES: Record<string, 'green' | 'navy' | 'amber' | 'red' | 'neutral' | 'teal'> = {
  CREATE: 'green',
  UPDATE: 'navy',
  DELETE: 'red',
  READ: 'neutral',
  LOGIN: 'teal',
  LOGOUT: 'neutral',
  LOGIN_FAILED: 'amber',
  PERMISSION_DENIED: 'red',
  EXPORT: 'amber',
  ASSIGN: 'navy',
  STATUS_CHANGE: 'navy',
};

/**
 * One audit entry.
 *
 * Collapsed to a sentence by default. The field-level diff, IP, user agent and
 * trace id are all real audit needs but only for the one row in a hundred
 * somebody is actually investigating — showing them inline turns a scannable
 * list into a wall.
 */
export function AuditRow({ entry }: { entry: AuditEntryView }) {
  const [open, setOpen] = useState(false);
  const changeCount = entry.changes ? Object.keys(entry.changes).length : 0;
  const hasDetail = changeCount > 0 || Boolean(entry.ipAddress || entry.traceId || entry.reason);

  return (
    <li className={entry.isSecurityRelevant ? 'border-l-[3px] border-danger-500' : ''}>
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={ACTION_TONES[entry.action] ?? 'neutral'}>{humanise(entry.action)}</Badge>
            <span className="text-sm">{entry.summary}</span>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--color-text-subtle)]">
            <span title={formatDateTime(entry.createdAt)}>{formatRelative(entry.createdAt)}</span>
            {entry.resourceId && entry.action !== 'PERMISSION_DENIED' ? (
              <>
                <span aria-hidden>·</span>
                {/* Suppressed for denials: there the id is the permission name,
                    which the sentence above already carries. */}
                <span className="font-mono">{entry.resourceId}</span>
              </>
            ) : null}
            {/* The label snapshot, not the live user record — so the row still
                names who did it after that person is deleted. */}
            {entry.actorLabel && !entry.actor ? (
              <>
                <span aria-hidden>·</span>
                <span>{entry.actorLabel} (removed)</span>
              </>
            ) : null}
          </div>
        </div>

        {hasDetail ? (
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="shrink-0 text-xs font-semibold text-[var(--color-text-muted)] underline underline-offset-2"
          >
            {open
              ? 'Hide'
              : changeCount > 0
                ? `${changeCount} ${changeCount === 1 ? 'change' : 'changes'}`
                : 'Details'}
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-3">
          {entry.reason ? (
            <p className="mb-3 text-sm">
              <span className="text-xs font-bold uppercase tracking-wide text-[var(--color-text-subtle)]">
                Reason
              </span>
              <br />
              {entry.reason}
            </p>
          ) : null}

          {entry.changes ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-[var(--color-text-subtle)]">
                  <tr>
                    <th scope="col" className="py-1 pr-4 font-bold uppercase tracking-wide">
                      Field
                    </th>
                    <th scope="col" className="py-1 pr-4 font-bold uppercase tracking-wide">
                      From
                    </th>
                    <th scope="col" className="py-1 font-bold uppercase tracking-wide">
                      To
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)] align-top">
                  {Object.entries(entry.changes).map(([field, change]) => (
                    <tr key={field}>
                      <td className="py-1.5 pr-4 font-semibold">{humanise(field)}</td>
                      <td className="py-1.5 pr-4 font-mono text-[var(--color-text-muted)]">
                        {render(change.from)}
                      </td>
                      <td className="py-1.5 font-mono">{render(change.to)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
            <Meta label="IP address" value={entry.ipAddress} />
            <Meta label="Trace id" value={entry.traceId} />
            <Meta label="Recorded" value={formatDateTime(entry.createdAt)} />
            {entry.userAgent ? (
              <div className="sm:col-span-3">
                <dt className="text-[var(--color-text-subtle)]">User agent</dt>
                <dd className="mt-0.5 break-all font-mono">{entry.userAgent}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : null}
    </li>
  );
}

function Meta({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[var(--color-text-subtle)]">{label}</dt>
      <dd className="mt-0.5 break-all font-mono">{value ?? '—'}</dd>
    </div>
  );
}

/**
 * Values arrive already redacted or masked by `sanitiseForAudit` on the way in.
 * This only has to render them legibly — it must never try to reconstruct one.
 */
function render(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value === '' ? '(empty)' : value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
