import { NextResponse } from 'next/server';

import { getAccessToken } from '@/lib/session';

const API_BASE =
  process.env.API_INTERNAL_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';

/**
 * Same-origin proxy for dictation.
 *
 * The browser cannot call the API directly — the access token lives in an
 * httpOnly cookie — and the speech provider's key must never reach a phone,
 * since it is billed by the second on SIHL's account.
 *
 * The API's error body is passed through rather than flattened: "the service
 * took too long" and "that format cannot be read" call for different reactions
 * from the rep, and either beats a generic failure.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const token = await getAccessToken();
  if (!token) {
    return NextResponse.json({ title: 'Not signed in', status: 401 }, { status: 401 });
  }

  const incoming = await request.formData();
  const audio = incoming.get('audio');
  if (!(audio instanceof File)) {
    return NextResponse.json({ title: 'No recording supplied', status: 400 }, { status: 400 });
  }

  // Rebuilt rather than forwarded, so nothing else the client attached to the
  // form travels on to the API.
  const outgoing = new FormData();
  outgoing.append('audio', audio, audio.name || 'note.wav');

  const response = await fetch(`${API_BASE}/speech/transcribe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: outgoing,
    cache: 'no-store',
  });

  const body = await response
    .json()
    .catch(() => ({ title: 'The note could not be transcribed', status: response.status }));

  return NextResponse.json(body, { status: response.status });
}
