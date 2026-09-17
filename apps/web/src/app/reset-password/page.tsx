import Link from 'next/link';

import { Logo } from '@/components/brand/Logo';
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm';

export const metadata = {
  title: 'Set a new password',
  // The token is in the URL. Nothing about this page should be indexed or
  // sent anywhere as a referrer.
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <main id="main" className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm">
        <Logo size="lg" />

        <h1 className="mt-8 text-2xl font-bold">Set a new password</h1>

        {token ? (
          <>
            <p className="mt-1.5 text-sm text-[var(--color-text-muted)]">
              Choose something you have not used here before. You will be signed out on every
              device once it is set.
            </p>
            <div className="mt-6">
              <ResetPasswordForm token={token} />
            </div>
          </>
        ) : (
          /*
            No token in the URL — usually a link that was wrapped onto two
            lines by a mail client and only half copied. Said plainly, because
            "invalid token" reads as though they did something wrong.
          */
          <div className="mt-6 rounded-lg border border-warn-500/40 bg-warn-50 p-5 text-sm dark:bg-warn-500/15">
            <p className="font-semibold">This link looks incomplete.</p>
            <p className="mt-2 text-[var(--color-text-muted)]">
              Email programs sometimes split a long link across two lines. Copy the whole thing
              from the email, or ask for a fresh one.
            </p>
            <p className="mt-4">
              <Link href="/forgot-password" className="btn btn-primary">
                Send me a new link
              </Link>
            </p>
          </div>
        )}

        <p className="mt-8 text-center text-sm">
          <Link
            href="/login"
            className="font-semibold text-[var(--color-text-muted)] underline underline-offset-2 hover:text-[var(--color-text)]"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
