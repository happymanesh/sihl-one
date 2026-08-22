import { ChangePasswordForm } from '@/components/auth/ChangePasswordForm';

/**
 * Changing your own password, without asking an administrator.
 *
 * The screen and the API already existed, but nothing linked to them unless the
 * system forced a change — so a rep who thought someone had watched them type
 * had to ask an admin for a temporary password. That is both slower and worse:
 * it puts a working password for their account in a third party's hands, which
 * is the opposite of what the person was worried about.
 *
 * The form is embedded rather than linked. A password change is a thirty-second
 * job and a page of its own for it, reached from a menu, is three navigations
 * for one field.
 */
export function PasswordPanel() {
  return (
    <section className="card p-5">
      <h2 className="font-bold">Password</h2>
      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
        Change it whenever you want to — you do not need an administrator. If you think someone
        saw you type it, change it now rather than waiting.
      </p>
      <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
        You will be signed out on every device and will need to sign in again. That is deliberate:
        a password change that left the old sessions running would not have changed anything for
        whoever else was using them.
      </p>

      <div className="mt-4 max-w-sm">
        <ChangePasswordForm />
      </div>
    </section>
  );
}
