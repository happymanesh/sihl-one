import { NextResponse } from 'next/server';

import { getAccessToken } from '@/lib/session';

const API_BASE =
  process.env.API_INTERNAL_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';

/**
 * Same-origin proxy for the duplicate-mobile check.
 *
 * The browser cannot call the API directly: the access token lives in an
 * httpOnly cookie, which is the point of keeping it there.
 *
 * Only `mobile` and `excludeLeadId` are forwarded. Passing the caller's query
 * string through wholesale would let anything appended in the browser reach the
 * API, and this endpoint answers questions about other people's clients.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const token = await getAccessToken();
  if (!token) {
    return NextResponse.json({ title: 'Not signed in', status: 401 }, { status: 401 });
  }

  const incoming = new URL(request.url).searchParams;
  const mobile = incoming.get('mobile');
  if (!mobile) {
    return NextResponse.json({ title: 'No mobile number supplied', status: 400 }, { status: 400 });
  }

  const params = new URLSearchParams({ mobile });
  const exclude = incoming.get('excludeLeadId');
  if (exclude) params.set('excludeLeadId', exclude);

  const response = await fetch(`${API_BASE}/leads/check-mobile?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  const body: unknown = await response.json().catch(() => null);
  return NextResponse.json(body ?? { exists: false, visible: false, lead: null }, {
    status: response.status,
  });
}
