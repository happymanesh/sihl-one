import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Logo } from '@/components/brand/Logo';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';
import { getCurrentUser, homeRouteFor } from '@/lib/auth';

export const metadata = { title: 'Forgot your password' };

export default async function ForgotPasswordPage() {
  // Somebody already signed in does not need this, and landing here from a
  // stale bookmark should not look like they have been signed out.
  const user = await getCurrentUser().catch(() => null);
  if (user) redirect(homeRouteFor(user));

  return (
    <main id="main" className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm">
        <Logo size="lg" />

        <h1 className="mt-8 text-2xl font-bold">Forgot your password</h1>
        <p className="mt-1.5 text-sm text-[var(--color-text-muted)]">
          Tell us how you sign in and we will email you a link to set a new password.
        </p>

        <div className="mt-6">
          <ForgotPasswordForm />
        </div>

        <p className="mt-8 text-center text-xs text-[var(--color-text-subtle)]">
          No email on your record?{' '}
          <Link href="/login" className="underline underline-offset-2">
            Your administrator can reset it for you.
          </Link>
        </p>
      </div>
    </main>
  );
}
