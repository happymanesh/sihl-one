import { NextResponse } from 'next/server';

import { getAccessToken } from '@/lib/session';
import { forwardedHeaders } from '@/lib/forwarded';

const API_BASE =
  process.env.API_INTERNAL_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';

/**
 * Streams document bytes.
 *
 * The `path` returned by the API is re-parsed and rebuilt here rather than
 * forwarded: accepting a caller-supplied path would let the browser aim this
 * route — which carries our credentials — at any address the server can reach.
 * Only a document id and a signed token survive the parse.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ title: 'Not signed in' }, { status: 401 });

  const path = new URL(request.url).searchParams.get('path') ?? '';
  const match = /^\/documents\/([A-Za-z0-9]{8,64})\/content\?token=(.+)$/.exec(path);
  if (!match) {
    return NextResponse.json({ title: 'Invalid download link' }, { status: 400 });
  }

  const [, documentId, rawToken] = match;
  const downloadToken = decodeURIComponent(rawToken!);

  const upstream = await fetch(
    `${API_BASE}/documents/${documentId}/content?token=${encodeURIComponent(downloadToken)}`,
    { headers: { Authorization: `Bearer ${token}`, ...(await forwardedHeaders()) }, cache: 'no-store' },
  );

  if (!upstream.ok) {
    return NextResponse.json({ title: 'Download unavailable' }, { status: upstream.status });
  }

  return new NextResponse(await upstream.arrayBuffer(), {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      // Always an attachment, never rendered inline in our own origin.
      'Content-Disposition':
        upstream.headers.get('content-disposition') ?? 'attachment',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
