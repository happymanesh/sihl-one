import { NextResponse } from 'next/server';

import { forwardedHeaders } from '@/lib/forwarded';
import { getAccessToken } from '@/lib/session';

const API_BASE =
  process.env.API_INTERNAL_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';

/**
 * Same-origin proxy for the report workbook.
 *
 * The browser cannot call the API directly — the access token lives in an
 * httpOnly cookie, which is the point of keeping it there — so the download has
 * to come through here. Only `from` and `to` are forwarded: passing the query
 * string through wholesale would let anything appended in the address bar reach
 * the API, and this endpoint returns the caller's whole book.
 *
 * Which sheets the workbook contains is decided by the API from the caller's
 * permissions, never here. A client-side flag would be a suggestion; the API's
 * check is the rule.
 */
export async function GET(request: Request): Promise<Response> {
  const token = await getAccessToken();
  if (!token) {
    return NextResponse.json({ title: 'Not signed in', status: 401 }, { status: 401 });
  }

  const incoming = new URL(request.url).searchParams;
  const params = new URLSearchParams();
  for (const key of ['from', 'to'] as const) {
    const value = incoming.get(key);
    if (value) params.set(key, value);
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';

  const upstream = await fetch(`${API_BASE}/reports/export${suffix}`, {
    headers: { Authorization: `Bearer ${token}`, ...(await forwardedHeaders()) },
    cache: 'no-store',
  });

  if (!upstream.ok) {
    const problem: unknown = await upstream.json().catch(() => null);
    return NextResponse.json(problem ?? { title: 'The report could not be built' }, {
      status: upstream.status,
    });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type':
        upstream.headers.get('content-type') ??
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="sihl-sales-report-${stamp}.xlsx"`,
      'X-Content-Type-Options': 'nosniff',
      // Never cached: the contents depend on who asked, and a shared cache
      // handing one person's scoped book to another is a reportable incident.
      'Cache-Control': 'private, no-store',
    },
  });
}
