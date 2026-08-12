import { AppShell } from '@/components/shell/AppShell';
import { logout } from '@/app/actions/auth';
import { requireUser } from '@/lib/auth';

/**
 * Authenticated shell.
 *
 * `requireUser()` runs here, so every route in this group is gated by a real
 * API call rather than by the presence of a cookie. A revoked session is
 * rejected on the next navigation, not at token expiry.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <AppShell user={user} onLogout={logout}>
      {children}
    </AppShell>
  );
}
