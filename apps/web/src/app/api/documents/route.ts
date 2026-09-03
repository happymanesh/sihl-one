import { NextResponse } from 'next/server';

import { getAccessToken } from '@/lib/session';
import { forwardedHeaders } from '@/lib/forwarded';

const API_BASE =
  process.env.API_INTERNAL_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';

const ENTITY_TYPES = new Set(['LEAD', 'CUSTOMER', 'PARTNER', 'OPPORTUNITY']);

/**
 * Same-origin proxy for document list and upload.
 *
 * Exists for the same reason as the file-upload proxy: the browser holds no
 * readable token, and a multi-megabyte upload should not travel as a server
 * action payload. Query parameters are rebuilt from a validated allow-list so
 * this route cannot be pointed at an arbitrary API path.
 */
function requireValidTarget(url: URL): { entityType: string; entityId: string } | null {
  const entityType = url.searchParams.get('entityType') ?? '';
  const entityId = url.searchParams.get('entityId') ?? '';

  if (!ENTITY_TYPES.has(entityType)) return null;
  if (!/^[a-z0-9]{8,64}$/i.test(entityId)) return null;

  return { entityType, entityId };
}

export async function GET(request: Request): Promise<NextResponse> {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ title: 'Not signed in' }, { status: 401 });

  const target = requireValidTarget(new URL(request.url));
  if (!target) return NextResponse.json({ title: 'Invalid request' }, { status: 400 });

  const response = await fetch(
    `${API_BASE}/documents?entityType=${target.entityType}&entityId=${target.entityId}`,
    { headers: { Authorization: `Bearer ${token}`, ...(await forwardedHeaders()) }, cache: 'no-store' },
  );

  return NextResponse.json(await response.json().catch(() => []), { status: response.status });
}

export async function POST(request: Request): Promise<NextResponse> {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ title: 'Not signed in' }, { status: 401 });

  const url = new URL(request.url);
  const target = requireValidTarget(url);
  if (!target) return NextResponse.json({ title: 'Invalid request' }, { status: 400 });

  const category = url.searchParams.get('category') ?? 'OTHER';
  if (!/^[A-Z_]{1,40}$/.test(category)) {
    return NextResponse.json({ title: 'Invalid category' }, { status: 400 });
  }

  const incoming = await request.formData();
  const file = incoming.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ title: 'No file supplied' }, { status: 400 });
  }

  const outgoing = new FormData();
  outgoing.append('file', file, file.name);

  const response = await fetch(
    `${API_BASE}/documents?entityType=${target.entityType}&entityId=${target.entityId}&category=${category}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, ...(await forwardedHeaders()) },
      body: outgoing,
      cache: 'no-store',
    },
  );

  return NextResponse.json(
    await response.json().catch(() => ({ title: 'Upload failed' })),
    { status: response.status },
  );
}
