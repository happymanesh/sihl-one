import { NextResponse } from 'next/server';

import { getAccessToken } from '@/lib/session';
import { forwardedHeaders } from '@/lib/forwarded';

const API_BASE =
  process.env.API_INTERNAL_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';

/**
 * Valid managers for a designation.
 *
 * Proxied because the picker reloads whenever the designation changes, which is
 * interactive and therefore client-side — and the access token lives in an
 * httpOnly cookie the browser cannot read.
 *
 * The API decides who is offered: only people strictly more senior, and only
 * within the caller's own org subtree. This route adds no authority.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ title: 'Not signed in' }, { status: 401 });

  const designationId = new URL(request.url).searchParams.get('designationId') ?? '';
  if (!/^[a-z0-9]{8,64}$/i.test(designationId)) {
    return NextResponse.json({ title: 'Invalid designation id' }, { status: 400 });
  }

  const response = await fetch(
    `${API_BASE}/admin/users/manager-options?designationId=${designationId}`,
    { headers: { Authorization: `Bearer ${token}`, ...(await forwardedHeaders()) }, cache: 'no-store' },
  );

  return NextResponse.json(await response.json().catch(() => []), { status: response.status });
}
