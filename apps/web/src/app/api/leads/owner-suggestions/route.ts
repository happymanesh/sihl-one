import { NextResponse } from 'next/server';

import { getAccessToken } from '@/lib/session';
import { forwardedHeaders } from '@/lib/forwarded';

const API_BASE =
  process.env.API_INTERNAL_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';

/**
 * Suggested owners for a lead.
 *
 * Proxied rather than fetched on the server with the page, because the panel is
 * opened on demand from the Assign tab and the access token lives in an
 * httpOnly cookie the browser cannot read. The API applies the caller's data
 * scope and the `lead:assign` permission; this route adds no authority.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ title: 'Not signed in' }, { status: 401 });

  const leadId = new URL(request.url).searchParams.get('leadId') ?? '';
  if (!/^[a-z0-9]{8,64}$/i.test(leadId)) {
    return NextResponse.json({ title: 'Invalid lead id' }, { status: 400 });
  }

  const response = await fetch(`${API_BASE}/leads/${leadId}/owner-suggestions`, {
    headers: { Authorization: `Bearer ${token}`, ...(await forwardedHeaders()) },
    cache: 'no-store',
  });

  return NextResponse.json(await response.json().catch(() => null), {
    status: response.status,
  });
}
