import type { ReactNode } from 'react';

import { humanise } from '@/lib/format';

type Tone = 'neutral' | 'navy' | 'teal' | 'green' | 'amber' | 'red' | 'blue';

/**
 * Colour is never the only signal. Every badge also carries its label as text,
 * so the ~8% of men with a colour vision deficiency — a real slice of any
 * broking sales floor — read the same information everyone else does.
 */
const TONES: Record<Tone, string> = {
  neutral: 'bg-[var(--color-surface-inset)] text-[var(--color-text-muted)]',
  navy: 'bg-navy-100 text-navy-700 dark:bg-navy-800 dark:text-navy-100',
  teal: 'bg-teal-100 text-teal-700 dark:bg-teal-800 dark:text-teal-50',
  green: 'bg-brand-green-100 text-brand-green-800 dark:bg-brand-green-800 dark:text-brand-green-50',
  amber: 'bg-warn-100 text-warn-600 dark:bg-warn-600/30 dark:text-warn-100',
  red: 'bg-danger-100 text-danger-600 dark:bg-danger-600/30 dark:text-danger-100',
  blue: 'bg-info-100 text-info-500 dark:bg-info-500/25 dark:text-info-100',
};

export function Badge({
  tone = 'neutral',
  children,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`badge ${TONES[tone]}`} title={title}>
      {children}
    </span>
  );
}

const LEAD_STATUS_TONES: Record<string, Tone> = {
  NEW: 'blue',
  CONTACTED: 'navy',
  QUALIFIED: 'teal',
  PROPOSAL: 'amber',
  CONVERTED: 'green',
  LOST: 'red',
  DISQUALIFIED: 'neutral',
};

export function LeadStatusBadge({ status }: { status: string }) {
  return <Badge tone={LEAD_STATUS_TONES[status] ?? 'neutral'}>{humanise(status)}</Badge>;
}

const KYC_TONES: Record<string, Tone> = {
  NOT_STARTED: 'neutral',
  IN_PROGRESS: 'blue',
  PENDING_VERIFICATION: 'amber',
  ON_HOLD: 'amber',
  REJECTED: 'red',
  COMPLETED: 'green',
};

export function KycBadge({ status }: { status: string }) {
  return <Badge tone={KYC_TONES[status] ?? 'neutral'}>{humanise(status)}</Badge>;
}

const PRIORITY_TONES: Record<string, Tone> = {
  LOW: 'neutral',
  MEDIUM: 'blue',
  HIGH: 'amber',
  URGENT: 'red',
};

export function PriorityBadge({ priority }: { priority: string }) {
  return <Badge tone={PRIORITY_TONES[priority] ?? 'neutral'}>{humanise(priority)}</Badge>;
}

/**
 * Lead score.
 *
 * Shows the number *and* the band. The number alone invites false precision
 * (nobody can act on the difference between 61 and 64); the band alone loses
 * the ordering an RM uses to pick who to call next.
 */
export function ScoreBadge({ score, band }: { score: number; band: string }) {
  const tone: Tone = band === 'HOT' ? 'red' : band === 'WARM' ? 'amber' : 'neutral';
  const label = band === 'HOT' ? 'Hot' : band === 'WARM' ? 'Warm' : 'Cold';
  return (
    <span className="inline-flex items-center gap-1.5" title={`Lead score ${score} of 100`}>
      <span
        aria-hidden
        className="inline-block h-1.5 w-8 overflow-hidden rounded-full bg-[var(--color-surface-inset)]"
      >
        <span
          className={`block h-full rounded-full ${
            band === 'HOT' ? 'bg-danger-500' : band === 'WARM' ? 'bg-warn-500' : 'bg-navy-300'
          }`}
          style={{ width: `${Math.max(4, score)}%` }}
        />
      </span>
      <Badge tone={tone}>
        {label} {score}
      </Badge>
    </span>
  );
}
