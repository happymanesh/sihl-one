import { redirect } from 'next/navigation';

import { Logo } from '@/components/brand/Logo';
import { ChangePasswordForm } from '@/components/auth/ChangePasswordForm';
import { getCurrentUser } from '@/lib/auth';

export const metadata = { title: 'Set a new password' };

/**
 * Deliberately outside the `(app)` group, and therefore outside the shell.
 *
 * A user who still owes a password change is refused by the API on every other
 * route, so rendering the navigation would offer them a menu where every item
 * returns 403. One screen, one task.
 */
export default async function ChangePasswordPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const forced = user.mustChangePassword;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo size="md" />
        </div>

        <div className="card p-6">
          <h1 className="text-xl font-bold">
            {forced ? 'Set your own password' : 'Change your password'}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {forced
              ? 'You are signed in with a password an administrator issued. Choose your own before continuing.'
              : 'Choose a new password for your account.'}
          </p>

          <div className="mt-5">
            <ChangePasswordForm forced={forced} />
          </div>
        </div>
      </div>
    </div>
  );
}
