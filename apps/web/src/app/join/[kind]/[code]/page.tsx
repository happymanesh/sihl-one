import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { CaptureContext } from '@sihl-one/contracts';

import { LeadCaptureForm } from '@/components/marketing/LeadCaptureForm';
import { formatDate } from '@/lib/format';

const API_BASE =
  process.env.API_INTERNAL_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';

interface Props {
  params: Promise<{ kind: string; code: string }>;
}

/**
 * Public capture landing page for a coded link.
 *
 * `/join/p/<referral code>` for a partner, `/join/e/<event code>` for an event.
 * Two segments rather than one shared namespace — see `captureUrl` in the
 * contracts for why a single namespace would misroute business silently.
 *
 * Unauthenticated: the person scanning the QR at a branch stall or opening a
 * link their advisor sent has no account, and requiring one is how a capture
 * form collects nothing.
 */
async function loadContext(kind: string, code: string): Promise<CaptureContext | null> {
  const response = await fetch(
    `${API_BASE}/events/capture-context/${kind}/${encodeURIComponent(code)}`,
    // Never cached: an event opening or closing must take effect on the next
    // scan, not after a revalidation window.
    { cache: 'no-store' },
  );
  if (!response.ok) return null;
  return (await response.json()) as CaptureContext;
}

export async function generateMetadata({ params }: Props) {
  const { kind, code } = await params;
  const context = await loadContext(kind, code);
  return {
    title: context ? `Open an account · ${context.attributedTo}` : 'Open an account',
    // A referral link is shared privately. Keeping it out of search results is
    // the least surprising default.
    robots: { index: false, follow: false },
  };
}

export default async function JoinPage({ params }: Props) {
  const { kind, code } = await params;
  if (kind !== 'p' && kind !== 'e') notFound();

  const context = await loadContext(kind, code);
  if (!context) {
    return (
      <Shell>
        <h1 className="text-xl font-bold">This link is not recognised</h1>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">
          {/* Said plainly rather than shown as a 404: the person holding this
              link did nothing wrong, and they still want an account. */}
          The code in this link does not match anything at SIHL. It may have been mistyped, or
          the link may have been replaced.
        </p>
        <Link href="/" className="btn btn-primary mt-4">
          Open an account on our website
        </Link>
      </Shell>
    );
  }

  if (!context.acceptingSubmissions) {
    return (
      <Shell>
        <h1 className="text-xl font-bold">{context.attributedTo}</h1>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">{context.closedReason}</p>
        <Link href="/" className="btn btn-primary mt-4">
          Open an account on our website
        </Link>
      </Shell>
    );
  }

  const isEvent = context.kind === 'EVENT';

  return (
    <Shell>
      <p className="text-xs font-bold uppercase tracking-wide text-teal-600 dark:text-teal-300">
        {isEvent ? 'Event registration' : 'Referred by'}
      </p>
      <h1 className="mt-1 text-2xl font-bold">{context.attributedTo}</h1>

      {isEvent ? (
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {context.venue ? `${context.venue} · ` : ''}
          {context.startsAt ? formatDate(context.startsAt) : ''}
        </p>
      ) : (
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Your enquiry will reach the SIHL team with {context.attributedTo} recorded as your
          introducer.
        </p>
      )}

      <div className="mt-6">
        <LeadCaptureForm
          partnerCode={context.kind === 'PARTNER' ? context.code : undefined}
          eventCode={context.kind === 'EVENT' ? context.code : undefined}
          submitLabel={isEvent ? 'Register my interest' : 'Request a call back'}
        />
      </div>

      <p className="mt-5 text-xs text-[var(--color-text-subtle)]">
        Investments in securities are subject to market risks. Read all related documents
        carefully before investing.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto min-h-screen max-w-lg px-4 py-10">
      <div className="mb-6 text-center">
        <span className="text-lg font-bold tracking-tight">SIHL ONE</span>
      </div>
      <div className="card p-6">{children}</div>
    </main>
  );
}
