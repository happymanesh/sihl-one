import { redirect } from 'next/navigation';
import Link from 'next/link';

import { Logo } from '@/components/brand/Logo';
import { LoginForm } from '@/components/auth/LoginForm';
import { getCurrentUser, homeRouteFor } from '@/lib/auth';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; next?: string }>;
}) {
  // The proxy no longer guesses whether a visitor is signed in — it cannot
  // validate a token on the edge. This is the authoritative check.
  const user = await getCurrentUser();
  if (user) redirect(homeRouteFor(user));

  const { reason, next } = await searchParams;

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel. Hidden below lg — on a phone the form should be the whole
          screen, since field staff sign in on mobile far more than on desktop. */}
      <div className="relative hidden overflow-hidden lg:block">
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-br from-navy-600 via-navy-500 to-teal-700"
        />
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
            backgroundSize: '28px 28px',
          }}
        />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <Logo size="lg" inverted />
          <div>
            <h1 className="max-w-md text-3xl font-extrabold leading-tight">
              One platform for every SIHL relationship.
            </h1>
            <p className="mt-4 max-w-md text-white/80">
              Leads, customers, onboarding, field visits and partner business — connected end to
              end, from the first enquiry to the first trade and beyond.
            </p>
          </div>
          <p className="text-xs text-white/60">
            Shah Investors Home Ltd. · SEBI Reg. INZ000167335
          </p>
        </div>
      </div>

      <main id="main" className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden">
            <Logo size="md" />
          </div>

          <h2 className="mt-8 text-2xl font-bold lg:mt-0">Sign in</h2>
          <p className="mt-1.5 text-sm text-[var(--color-text-muted)]">
            For SIHL staff and associate partners.
          </p>

          {reason === 'expired' ? (
            <div
              className="mt-5 rounded-lg border border-warn-500/40 bg-warn-50 px-3 py-2 text-sm text-warn-600 dark:bg-warn-500/15"
              role="status"
            >
              Your session expired. Please sign in again.
            </div>
          ) : reason === 'password-changed' ? (
            <div
              className="mt-5 rounded-lg border border-teal-500/40 bg-teal-50 px-3 py-2 text-sm text-teal-700 dark:bg-teal-900/30 dark:text-teal-200"
              role="status"
            >
              Your password has been changed. Sign in with the new one.
            </div>
          ) : reason === 'unavailable' ? (
            <div
              className="mt-5 rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600 dark:bg-danger-500/15"
              role="status"
            >
              We could not reach the SIHL ONE service. Your session has been left intact — try
              again in a moment.
            </div>
          ) : null}

          <div className="mt-6">
            <LoginForm next={next} />
          </div>

          <p className="mt-6 text-center text-sm text-[var(--color-text-muted)]">
            Looking to open an account?{' '}
            <Link href="/" className="font-semibold text-teal-600 hover:underline dark:text-teal-300">
              Start here
            </Link>
          </p>

          {process.env.NODE_ENV !== 'production' ? <DemoCredentials /> : null}
        </div>
      </main>
    </div>
  );
}

/**
 * Development-only credential hint.
 *
 * Rendered behind a NODE_ENV check rather than a feature flag, so there is no
 * configuration mistake that could put demo passwords on a production login
 * page — the code is not in the production bundle at all.
 */
function DemoCredentials() {
  const accounts = [
    ['admin@sihl.in', 'Super admin'],
    ['salesmanager@sihl.in', 'Sales manager — team scope'],
    ['rahul.mehta@sihl.in', 'Sales executive — own leads only'],
    ['md@sihl.in', 'Management — read-only'],
    ['partner@trinetrafin.in', 'Associate partner'],
  ];

  return (
    <details className="mt-8 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-xs">
      <summary className="cursor-pointer font-semibold text-[var(--color-text-muted)]">
        Demo accounts (development only)
      </summary>
      <ul className="mt-2.5 space-y-1.5">
        {accounts.map(([email, role]) => (
          <li key={email} className="flex flex-wrap justify-between gap-2">
            <code className="font-mono text-[var(--color-text)]">{email}</code>
            <span className="text-[var(--color-text-subtle)]">{role}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2.5 text-[var(--color-text-subtle)]">
        Password for all: <code className="font-mono">Sihl@One2026!</code>
      </p>
    </details>
  );
}
