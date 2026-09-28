import 'server-only';

import { cookies } from 'next/headers';

/**
 * Token storage.
 *
 * Both tokens live in httpOnly cookies set by server actions, never in
 * localStorage. localStorage is readable by any script on the page, so a single
 * XSS — or one compromised npm dependency — hands an attacker a valid session
 * for a system holding customer PII. httpOnly cookies are not reachable from
 * JavaScript at all, which removes that entire class of theft.
 *
 * The cost is CSRF exposure, which `sameSite: 'lax'` plus the API's CORS
 * allow-list covers: a cross-site form POST cannot carry these cookies, and a
 * cross-origin fetch cannot read the response.
 */
export const ACCESS_COOKIE = 'sihl_access';
export const REFRESH_COOKIE = 'sihl_refresh';

const isProduction = process.env.NODE_ENV === 'production';

const baseOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  // Secure is conditional purely so local http://localhost development works.
  // Every deployed environment is HTTPS-only.
  secure: isProduction,
};

/** How long a remembered session survives without signing in again. */
const REMEMBERED_DAYS = 30;

/**
 * Writes the session.
 *
 * `remember` decides whether the cookies outlive the browser. Without it they
 * are session cookies — no `maxAge`, so they are dropped when the window
 * closes. With it they persist for a month.
 *
 * Not remembering is the default, and that is a tightening rather than a new
 * choice: every session used to persist for thirty days whether the person
 * wanted it or not, including on the shared machine at a branch counter where
 * the next person to open the browser inherited it. Somebody who wants the
 * convenience now asks for it.
 *
 * The server's own limits are untouched and still win. The access token expires
 * on its own schedule, the refresh token has a fixed life at the API, and the
 * idle timeout signs an unattended session out regardless of what the cookie
 * says. A remembered session is one that survives closing the laptop, not one
 * that never ends.
 */
export async function setSessionCookies(
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  },
  remember = false,
): Promise<void> {
  const store = await cookies();

  store.set(ACCESS_COOKIE, tokens.accessToken, {
    ...baseOptions,
    ...(remember ? { maxAge: tokens.expiresIn } : {}),
  });

  store.set(REFRESH_COOKIE, tokens.refreshToken, {
    ...baseOptions,
    ...(remember ? { maxAge: 60 * 60 * 24 * REMEMBERED_DAYS } : {}),
  });
}

export async function clearSessionCookies(): Promise<void> {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
}

export async function getAccessToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(ACCESS_COOKIE)?.value ?? null;
}

export async function getRefreshToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(REFRESH_COOKIE)?.value ?? null;
}
