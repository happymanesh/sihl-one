import { NextResponse } from 'next/server';

import { getAccessToken } from '@/lib/session';

const API_BASE =
  process.env.API_INTERNAL_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';

/** Requests a short-lived download grant for a document. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ title: 'Not signed in' }, { status: 401 });

  const { id } = await params;
  if (!/^[a-z0-9]{8,64}$/i.test(id)) {
    return NextResponse.json({ title: 'Invalid document id' }, { status: 400 });
  }

  const response = await fetch(`${API_BASE}/documents/${id}/download`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });

  return NextResponse.json(
    await response.json().catch(() => ({ title: 'Download unavailable' })),
    { status: response.status },
  );
}
