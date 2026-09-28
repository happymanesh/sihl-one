import { NextResponse } from 'next/server';

import { forwardedHeaders } from '@/lib/forwarded';
import { getAccessToken } from '@/lib/session';

const API_BASE =
  process.env.API_INTERNAL_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';

/**
 * Keeps a session alive when the person says they are still there.
 *
 * The API revokes any session whose last request is older than the idle
 * timeout, and it learns about activity only from requests — so somebody
 * reading a long page is idle as far as the server is concerned, however much
 * they are scrolling. This is what the "still there?" dialog calls: one cheap
 * authenticated request whose only job is to be a request, which touches
 * `lastSeenAt` on the way through.
 *
 * `/auth/me` rather than a purpose-built endpoint. Adding a route whose stated
 * purpose is to reset the idle clock would be a route that resets the idle
 * clock for anyone who finds it; this one already requires a live session and
 * returns only what the caller is.
 *
 * A 401 is not an error here. It means the session went while the dialog was on
 * screen, and the answer is the same either way: the client is told it is over
 * and sends the person to sign in.
 */
export async function POST(): Promise<Response> {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ alive: false }, { status: 200 });

  try {
    const upstream = await fetch(`${API_BASE}/auth/me`, {
      headers: { Authorization: `Bearer ${token}`, ...(await forwardedHeaders()) },
      cache: 'no-store',
    });
    return NextResponse.json({ alive: upstream.ok }, { status: 200 });
  } catch {
    // The API is unreachable. Report the session as alive rather than throwing
    // somebody out over a blip — the server is the authority on whether it is
    // really gone, and it will say so on the next navigation.
    return NextResponse.json({ alive: true }, { status: 200 });
  }
}
