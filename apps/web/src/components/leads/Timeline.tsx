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
export function Timeline({ entries }: { entries: Entry[] }) {
  if (entries.length === 0) {
    return (
      <p className="mt-5 text-sm text-[var(--color-text-muted)]">
        Nothing logged yet. The first call, message or meeting will appear here.
      </p>
    );
  }

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
