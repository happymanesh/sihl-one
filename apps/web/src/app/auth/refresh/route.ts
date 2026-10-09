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
/**
 * A redirect to a path, with no host in it at all.
 *
 * `NextResponse.redirect` demands an absolute URL, and the only host available
 * in a route handler is the one `request.url` carries — which is the address
 * the *container* was reached on, not the one the browser used. Behind a
 * reverse proxy that is `localhost:3000`, so every redirect out of this route
 * sent people to a host their machine refuses to connect to. It is how a
 * session that expired mid-edit became ERR_CONNECTION_REFUSED on
 * `localhost:3000/leads/<id>`.
 *
 * A relative `Location` has no host to get wrong: the browser resolves it
 * against wherever it actually is. RFC 7231 has allowed this since 2014 and
 * every browser in use handles it.
 *
 * 303 rather than 307: this ends a GET and the next request must also be a GET,
 * whatever the navigation that started it was.
 */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const rawNext = url.searchParams.get('next') ?? '/dashboard';

  // Only same-site paths. An open redirect here would be handed a valid session
  // on the way out, which is about as bad as an open redirect gets.
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/dashboard';

  const refreshToken = await getRefreshToken();
  if (!refreshToken) return signOut(next);

  let tokens: AuthTokens;
  try {
    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    });

    if (!response.ok) return signOut(next);
    tokens = (await response.json()) as AuthTokens;
  } catch {
    // The API is unreachable. Do not clear the cookies — the session may still
    // be perfectly valid, and destroying it because of a transient network
    // failure would sign everyone out during a blip.
    return redirectTo('/login?reason=unavailable');
  }

  const response = redirectTo(next);
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
function signOut(next: string): NextResponse {
  const response = redirectTo(`/login?reason=expired&next=${encodeURIComponent(next)}`);
  response.cookies.delete(ACCESS_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
  return response;
}
