import { NextResponse } from 'next/server';

import { getAccessToken } from '@/lib/session';
import { forwardedHeaders } from '@/lib/forwarded';

const API_BASE =
  process.env.API_INTERNAL_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';

/**
 * Same-origin proxy for attaching training material.
 *
 * Same reasoning as the documents proxy: the browser holds no readable token,
 * and a 25MB deck should not travel as a server-action payload. The id is
 * matched against the cuid shape rather than forwarded as given, so this route
 * cannot be aimed at an arbitrary API path.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ title: 'Not signed in' }, { status: 401 });

  const { id } = await params;
  if (!/^[a-z0-9]{8,64}$/i.test(id)) {
    return NextResponse.json({ title: 'Invalid training id' }, { status: 400 });
  }

  const incoming = await request.formData();
  const file = incoming.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ title: 'No file supplied' }, { status: 400 });
  }

  const outgoing = new FormData();
  outgoing.append('file', file, file.name);

  const response = await fetch(`${API_BASE}/training/${id}/material`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(await forwardedHeaders()) },
    body: outgoing,
    cache: 'no-store',
  });

  return NextResponse.json(await response.json().catch(() => ({ title: 'Upload failed' })), {
    status: response.status,
  });
}
