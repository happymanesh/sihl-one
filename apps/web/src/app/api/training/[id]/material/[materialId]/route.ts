import { NextResponse } from 'next/server';

import { getAccessToken } from '@/lib/session';
import { forwardedHeaders } from '@/lib/forwarded';

const API_BASE =
  process.env.API_INTERNAL_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';

/**
 * Streams attached training material through the Next server.
 *
 * Both ids are rebuilt from the cuid shape rather than forwarded as supplied —
 * passing a caller-chosen path through a credentialed fetch is a server-side
 * request forgery primitive. The API decides who may read the file; this route
 * adds no authority of its own.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; materialId: string }> },
): Promise<NextResponse> {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ title: 'Not signed in' }, { status: 401 });

  const { id, materialId } = await params;
  const isId = (value: string) => /^[a-z0-9]{8,64}$/i.test(value);
  if (!isId(id) || !isId(materialId)) {
    return NextResponse.json({ title: 'Invalid request' }, { status: 400 });
  }

  const upstream = await fetch(`${API_BASE}/training/${id}/material/${materialId}`, {
    headers: { Authorization: `Bearer ${token}`, ...(await forwardedHeaders()) },
    cache: 'no-store',
  });

  if (!upstream.ok) {
    return NextResponse.json({ title: 'File unavailable' }, { status: upstream.status });
  }

  return new NextResponse(await upstream.arrayBuffer(), {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      // Carried through as sent: it holds the original filename, which is the
      // only thing telling the reader which deck they just saved.
      'Content-Disposition': upstream.headers.get('content-disposition') ?? 'attachment',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
