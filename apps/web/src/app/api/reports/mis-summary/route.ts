import { NextResponse } from 'next/server';

import { forwardedHeaders } from '@/lib/forwarded';
import { getAccessToken } from '@/lib/session';
import { istDayKey } from '@/lib/time';

const API_BASE =
  process.env.API_INTERNAL_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Same-origin proxy for the MIS Summary workbook.
 *
 * The browser holds no readable token — it lives in an httpOnly cookie, which
 * is the point of keeping it there — so the download has to come through
 * here. The same shape as the daily-activity proxy beside it, and for the same
 * reasons.
 *
 * Only `date` is forwarded. Passing the query string through wholesale would
 * let anything appended in the address bar reach an endpoint that returns a
 * whole book of leads.
 */
export async function GET(request: Request): Promise<Response> {
  const token = await getAccessToken();
  if (!token) {
    return NextResponse.json({ title: 'Not signed in', status: 401 }, { status: 401 });
  }

  const date = new URL(request.url).searchParams.get('date');
  const suffix = date ? `?date=${encodeURIComponent(date)}` : '';

  const upstream = await fetch(`${API_BASE}/reports/mis-summary${suffix}`, {
    headers: { Authorization: `Bearer ${token}`, ...(await forwardedHeaders()) },
    cache: 'no-store',
  });

  if (!upstream.ok) {
    const problem: unknown = await upstream.json().catch(() => null);
    return NextResponse.json(problem ?? { title: 'The report could not be built' }, {
      status: upstream.status,
    });
  }

  // The API names the file after the day it actually covered, which is not
  // always the day asked for — "yesterday" when no date was given. Its header
  // is preferred, and today's date is only the fallback.
  const fallback = `attachment; filename="sihl-mis-summary-${date ?? istDayKey()}.xlsx"`;
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? XLSX,
      'Content-Disposition': upstream.headers.get('content-disposition') ?? fallback,
      'X-Content-Type-Options': 'nosniff',
      // Never cached: the contents depend on who asked, and a shared cache
      // handing one person's scoped rows to another is a reportable incident.
      'Cache-Control': 'private, no-store',
    },
  });
}
