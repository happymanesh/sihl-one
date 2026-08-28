import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { logout } from '@/app/actions/auth';
import { apiFetch } from '@/lib/api';
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

  // A temporary password gets you in and nowhere else. The API refuses every
  // route in this group while the flag is set, so without this redirect the
  // user would land on a shell where each page returns 403.
  if (user.mustChangePassword) redirect('/change-password' as Route);

  // Fetched here rather than in the bell so the badge is right on every
  // navigation without the client polling for it. Never allowed to break the
  // shell: a failing count renders a bell with no badge, not an error page.
  const { unread } = await apiFetch<{ unread: number }>('/notifications/unread-count').catch(
    () => ({ unread: 0 }),
  );

  return (
    <AppShell user={user} onLogout={logout} unreadNotifications={unread}>
      {children}
    </AppShell>
  );
}
