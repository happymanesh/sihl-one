import { NextResponse } from 'next/server';
import type { AuthTokens } from '@sihl-one/contracts';

import { ACCESS_COOKIE, REFRESH_COOKIE, getRefreshToken } from '@/lib/session';

const API_BASE =
  process.env.API_INTERNAL_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Silent session refresh.
 *
 * The access cookie lives 15 minutes; the refresh cookie lives 30 days. Without
 * this route the refresh token was never spent, so a session that was designed
 * to last a month actually ended after fifteen minutes — and, worse, left the
 * browser bouncing between `/login` and `/dashboard` because the proxy saw a
 * cookie while the app could not validate one.
 *
 * It is a route handler rather than logic inside `apiFetch` for a concrete
 * reason: refresh tokens rotate and are single-use, and the API revokes every
 * session when it sees a rotated token replayed. Refreshing from inside an
 * arbitrary server render would let several in-flight renders spend the same
 * token and log the user out. A single navigation-time route serialises it.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const rawNext = url.searchParams.get('next') ?? '/dashboard';

  // Only same-site paths. An open redirect here would be handed a valid session
  // on the way out, which is about as bad as an open redirect gets.
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/dashboard';

  const refreshToken = await getRefreshToken();
  if (!refreshToken) return signOut(url, next);

  let tokens: AuthTokens;
  try {
    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    });

    if (!response.ok) return signOut(url, next);
    tokens = (await response.json()) as AuthTokens;
  } catch {
    // The API is unreachable. Do not clear the cookies — the session may still
    // be perfectly valid, and destroying it because of a transient network
    // failure would sign everyone out during a blip.
    const retry = NextResponse.redirect(new URL('/login?reason=unavailable', url));
    return retry;
  }

  const response = NextResponse.redirect(new URL(next, url));
  const options = {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    secure: isProduction,
  };

  response.cookies.set(ACCESS_COOKIE, tokens.accessToken, {
    ...options,
    maxAge: tokens.expiresIn,
  });
  response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, {
    ...options,
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}

/** Clears both cookies and sends the user to sign in again. */
function signOut(base: URL, next: string): NextResponse {
  const target = new URL(
    `/login?reason=expired&next=${encodeURIComponent(next)}`,
    base,
  );
  const response = NextResponse.redirect(target);
  response.cookies.delete(ACCESS_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
  return response;
}
