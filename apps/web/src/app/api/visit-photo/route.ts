import { NextResponse } from 'next/server';

import { getAccessToken } from '@/lib/session';

const API_BASE =
  process.env.API_INTERNAL_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';

/**
 * Streams a visit check-in photo through the Next server.
 *
 * The URL is rebuilt here from two narrow parameters rather than accepting a
 * path from the client. Forwarding a caller-supplied path would turn this into
 * a server-side request forgery primitive: the browser could aim it at any
 * internal address the API server can reach, with our credentials attached.
 *
 * The API still enforces everything that matters — the visit must be in the
 * caller's scope, and the signed token must match the object, the user and the
 * expiry. This route adds no authority of its own.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    return NextResponse.json({ title: 'Not signed in' }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const visitId = params.get('visitId') ?? '';
  const token = params.get('token') ?? '';

  // Ids are cuids; anything else is not a visit id and must not reach the API.
  if (!/^[a-z0-9]{8,64}$/i.test(visitId) || token.length === 0 || token.length > 256) {
    return NextResponse.json({ title: 'Invalid request' }, { status: 400 });
  }

  const upstream = await fetch(
    `${API_BASE}/visits/${visitId}/photo?token=${encodeURIComponent(token)}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store' },
  );

  if (!upstream.ok) {
    return NextResponse.json({ title: 'Photo unavailable' }, { status: upstream.status });
  }

  return new NextResponse(await upstream.arrayBuffer(), {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'image/jpeg',
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      // A photograph of an employee: never cached by a shared proxy.
      'Cache-Control': 'private, max-age=60',
    },
  });
}
