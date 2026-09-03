import { NextResponse } from 'next/server';

import { getAccessToken } from '@/lib/session';
import { forwardedHeaders } from '@/lib/forwarded';

const API_BASE =
  process.env.API_INTERNAL_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';

/**
 * Marks the session as active, for "Stay signed in" on the idle warning.
 *
 * Any authenticated call refreshes `session.lastSeenAt` server-side, so this
 * proxies the cheapest one there is. Without it the button would only reset the
 * timer in the browser: a rep reading a long page makes no API calls, so the
 * server would still consider them idle and sign them out despite being told
 * they had been kept in.
 *
 * Proxied rather than called directly because the access token lives in an
 * httpOnly cookie the browser cannot read.
 */
export async function POST(): Promise<NextResponse> {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ ok: false }, { status: 401 });

  const response = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}`, ...(await forwardedHeaders()) },
    cache: 'no-store',
  }).catch(() => null);

  return NextResponse.json({ ok: response?.ok ?? false }, { status: response?.ok ? 200 : 401 });
}
