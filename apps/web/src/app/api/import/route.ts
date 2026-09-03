import { NextResponse } from 'next/server';

import { getAccessToken } from '@/lib/session';
import { forwardedHeaders } from '@/lib/forwarded';

const API_BASE =
  process.env.API_INTERNAL_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';

/**
 * Same-origin proxy for the import wizard.
 *
 * The wizard is interactive and holds state across steps, so it is a client
 * component — which means it cannot read the access token (httpOnly cookie) or
 * post a multi-megabyte file through a server action. This attaches the token
 * server-side.
 *
 * `step` is matched against a fixed allow-list and the upstream path is rebuilt
 * here. Forwarding a caller-supplied path would turn this into a server-side
 * request forgery primitive pointed at anything the API host can reach.
 */
const STEPS = new Set(['parse', 'validate', 'commit']);
const ID_PATTERN = /^[a-z0-9]{8,64}$/i;

export async function POST(request: Request): Promise<NextResponse> {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ title: 'Not signed in' }, { status: 401 });

  const url = new URL(request.url);
  const step = url.searchParams.get('step') ?? '';
  if (!STEPS.has(step)) {
    return NextResponse.json({ title: 'Unknown import step' }, { status: 400 });
  }

  if (step === 'parse') {
    // The provenance declaration travels as query parameters alongside the
    // file, and is validated by the API — never trusted from here.
    const declaration = new URLSearchParams({
      origin: url.searchParams.get('origin') ?? '',
      suppliedBy: url.searchParams.get('suppliedBy') ?? '',
      description: url.searchParams.get('description') ?? '',
      lawfulBasisConfirmed: url.searchParams.get('lawfulBasisConfirmed') ?? 'false',
    });

    const incoming = await request.formData();
    const file = incoming.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ title: 'No file supplied' }, { status: 400 });
    }

    const outgoing = new FormData();
    outgoing.append('file', file, file.name);

    const response = await fetch(`${API_BASE}/leads/import/parse?${declaration}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, ...(await forwardedHeaders()) },
      body: outgoing,
      cache: 'no-store',
    });

    return NextResponse.json(
      await response.json().catch(() => ({ title: 'Upload failed' })),
      { status: response.status },
    );
  }

  const batchId = url.searchParams.get('batchId') ?? '';
  if (!ID_PATTERN.test(batchId)) {
    return NextResponse.json({ title: 'Invalid batch id' }, { status: 400 });
  }

  const response = await fetch(`${API_BASE}/leads/import/${batchId}/${step}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(await forwardedHeaders()) },
    body: await request.text(),
    cache: 'no-store',
  });

  return NextResponse.json(
    await response.json().catch(() => ({ title: 'Request failed' })),
    { status: response.status },
  );
}
