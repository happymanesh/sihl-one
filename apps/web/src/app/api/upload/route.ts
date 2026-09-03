import { NextResponse } from 'next/server';

import { getAccessToken } from '@/lib/session';
import { forwardedHeaders } from '@/lib/forwarded';

const API_BASE =
  process.env.API_INTERNAL_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';

const ALLOWED_PURPOSES = new Set(['VISIT_PHOTO', 'VOICE_NOTE']);

/**
 * Same-origin upload proxy.
 *
 * The browser cannot call the API directly: the access token lives in an
 * httpOnly cookie that JavaScript cannot read, and that is deliberate (see
 * `lib/session.ts`). A server action is also the wrong tool here — a multi-
 * megabyte photo would have to be encoded into the action payload and would hit
 * the body-size limit.
 *
 * So this route takes the multipart stream, attaches the token server-side, and
 * forwards it. The token never reaches the client, and the deployment topology
 * (same host, different host, gateway) stops mattering to the browser.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const token = await getAccessToken();
  if (!token) {
    return NextResponse.json(
      { title: 'Not signed in', status: 401 },
      { status: 401 },
    );
  }

  const purpose = new URL(request.url).searchParams.get('purpose') ?? '';
  if (!ALLOWED_PURPOSES.has(purpose)) {
    // Checked here as well as in the API so a bad value fails before the bytes
    // are forwarded, and so this route cannot be used as an open relay to
    // arbitrary API paths.
    return NextResponse.json(
      { title: 'Unsupported upload purpose', status: 400 },
      { status: 400 },
    );
  }

  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ title: 'No file supplied', status: 400 }, { status: 400 });
  }

  // Rebuilt rather than forwarded as-is, so nothing else the client attached to
  // the form is passed through to the API.
  const outgoing = new FormData();
  outgoing.append('file', file, file.name);

  const response = await fetch(
    `${API_BASE}/files?purpose=${encodeURIComponent(purpose)}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, ...(await forwardedHeaders()) },
      body: outgoing,
      cache: 'no-store',
    },
  );

  const body = await response.json().catch(() => ({
    title: 'Upload failed',
    status: response.status,
  }));

  return NextResponse.json(body, { status: response.status });
}
