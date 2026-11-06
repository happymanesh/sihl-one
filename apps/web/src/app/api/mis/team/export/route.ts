import { NextResponse } from 'next/server';

import { forwardedHeaders } from '@/lib/forwarded';
import { getAccessToken } from '@/lib/session';
import { istDayKey } from '@/lib/time';

const API_BASE =
  process.env.API_INTERNAL_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';

/**
 * Same-origin proxy for the team performance CSV.
 *
 * The browser cannot call the API directly — the access token lives in an
 * httpOnly cookie, which is the point of keeping it there — so the download
 * comes through here.
 *
 * One parameter is forwarded, by name. Passing the query string through
 * wholesale would let anything appended in the address bar reach an endpoint
 * that returns every member of staff and what they are carrying.
 *
 * Whether the caller may export at all is decided by the API from `mis:read`.
 * Nothing is checked here — a client-side check is a suggestion, not a rule.
 */
export async function GET(request: Request): Promise<Response> {
  const token = await getAccessToken();
  if (!token) {
    return NextResponse.json({ title: 'Not signed in', status: 401 }, { status: 401 });
  }

  const incoming = new URL(request.url).searchParams;
  const params = new URLSearchParams();
  const verticalHeadId = incoming.get('verticalHeadId');
  if (verticalHeadId) params.set('verticalHeadId', verticalHeadId);

  const query = params.toString();
  const upstream = await fetch(`${API_BASE}/mis/team/export${query ? `?${query}` : ''}`, {
    headers: { Authorization: `Bearer ${token}`, ...(await forwardedHeaders()) },
    cache: 'no-store',
  });

  if (!upstream.ok) {
    const problem: unknown = await upstream.json().catch(() => null);
    return NextResponse.json(problem ?? { title: 'Export failed' }, { status: upstream.status });
  }

  /*
    Streamed rather than buffered, and the filename rebuilt here.

    The API sets its own `Content-Disposition`, but a proxied response does not
    carry it unless it is copied — and a CSV that downloads as `route` is one
    somebody has to rename before they can file it.
  */
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="team-performance-${istDayKey()}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
