import { NextResponse } from 'next/server';

import { forwardedHeaders } from '@/lib/forwarded';
import { getAccessToken } from '@/lib/session';
import { istDayKey } from '@/lib/time';

const API_BASE =
  process.env.API_INTERNAL_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';

/**
 * Same-origin proxy for the staff directory CSV.
 *
 * The browser cannot call the API directly — the access token lives in an
 * httpOnly cookie, which is the point of keeping it there — so the download has
 * to come through here.
 *
 * Nothing is decided in this file. Who appears in the file is decided by the
 * API from the caller's permissions and reporting line, and the export is
 * audited there. A check here would be a suggestion, not a rule.
 */
export async function GET(): Promise<Response> {
  const token = await getAccessToken();
  if (!token) {
    return NextResponse.json({ title: 'Not signed in', status: 401 }, { status: 401 });
  }

  const upstream = await fetch(`${API_BASE}/admin/users/export`, {
    headers: { Authorization: `Bearer ${token}`, ...(await forwardedHeaders()) },
    cache: 'no-store',
  });

  if (!upstream.ok) {
    const problem: unknown = await upstream.json().catch(() => null);
    return NextResponse.json(problem ?? { title: 'The export could not be built' }, {
      status: upstream.status,
    });
  }

  const stamp = istDayKey();
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="sihl-users-${stamp}.csv"`,
      'X-Content-Type-Options': 'nosniff',
      // Never cached: it carries staff contact details and depends on who asked.
      'Cache-Control': 'private, no-store',
    },
  });
}
