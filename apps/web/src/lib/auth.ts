import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { Route } from 'next';
import type { AuthenticatedUser, Permission } from '@sihl-one/contracts';

import { apiFetch } from './api';
import { getAccessToken } from './session';

/**
 * Current user for the request.
 *
 * `cache()` deduplicates within a single render pass: the layout, the sidebar
 * and three page components all ask for the user and exactly one API call is
 * made. Without it every server component that needs a permission check adds a
 * round-trip.
 */
export const getCurrentUser = cache(async (): Promise<AuthenticatedUser | null> => {
  const token = await getAccessToken();
  if (!token) return null;

  try {
    return await apiFetch<AuthenticatedUser>('/auth/me', { allowUnauthenticated: true });
  } catch {
    return null;
  }
});

/** Use in any authenticated page or layout. Redirects rather than returning null. */
export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

/**
 * Permission check for the UI.
 *
 * This hides controls the user cannot use — it is not the security boundary.
 * The API re-checks every permission on every call, because anything enforced
 * only in the browser is enforced nowhere.
 */
export function can(user: AuthenticatedUser | null, permission: Permission): boolean {
  return Boolean(user?.permissions.includes(permission));
}

export function canAny(user: AuthenticatedUser | null, permissions: Permission[]): boolean {
  return permissions.some((permission) => can(user, permission));
}

/**
 * Landing route per role. A sales executive opening the app wants their own
 * pipeline; a marketer wants campaigns. Sending everyone to the same dashboard
 * makes the first click a correction for most of them.
 */
export function homeRouteFor(user: AuthenticatedUser): Route {
  if (user.roles.includes('CUSTOMER')) return '/portal' as Route;
  if (user.roles.includes('PARTNER')) return '/partner' as Route;
  return '/dashboard';
}
