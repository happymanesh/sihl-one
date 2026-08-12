import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge-level gate.
 *
 * Next 16 renamed `middleware.ts` to `proxy.ts`; the behaviour is unchanged.
 *
 * This only inspects whether cookies are *present*. It deliberately does not
 * verify them: this runs on the edge runtime, before any application code, and
 * validating a session properly means a database round-trip on every request.
 * The real check is `requireUser()` in the authenticated layout, which calls
 * the API and therefore catches revoked sessions, suspended accounts and role
 * changes.
 *
 * The one rule that matters here: **the proxy must never contradict
 * `requireUser()`.** It previously bounced `/login` → `/dashboard` whenever any
 * cookie existed, while `requireUser()` sent unauthenticated users the other
 * way — so once the 15-minute access cookie expired and only the 30-day refresh
 * cookie remained, the browser looped between the two forever. The proxy now
 * defers every "are you actually signed in" decision to the app, and confines
 * itself to two things it can decide safely.
 */
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/leads',
  '/pipeline',
  '/customers',
  '/tasks',
  '/visits',
  '/campaigns',
  '/partners',
  '/admin',
  '/partner',
  '/portal',
];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const hasAccess = request.cookies.has('sihl_access');
  const hasRefresh = request.cookies.has('sihl_refresh');

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (!isProtected) {
    // Includes /login. Whether a visitor there is genuinely signed in is a
    // question only the API can answer, so the login page asks it and redirects
    // itself. Guessing here is what created the loop.
    return NextResponse.next();
  }

  // Access token gone but the refresh token is still good — the ordinary state
  // of someone returning after a break. Spend the refresh token and carry on to
  // where they were going, rather than making them sign in again.
  if (!hasAccess && hasRefresh) {
    const url = request.nextUrl.clone();
    url.pathname = '/auth/refresh';
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  if (!hasAccess && !hasRefresh) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    // Preserve the destination so sign-in lands there rather than dumping
    // everyone on the dashboard.
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  /**
   * Static assets are excluded explicitly. Matching them would send Next's own
   * image-optimisation fetches through the auth redirect and silently break
   * every image on the page — a mistake worth encoding in the matcher rather
   * than rediscovering.
   */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
  ],
};
