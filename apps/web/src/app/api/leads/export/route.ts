import { NextResponse } from 'next/server';

import { forwardedHeaders } from '@/lib/forwarded';
import { getAccessToken } from '@/lib/session';

const API_BASE =
  process.env.API_INTERNAL_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';

/**
 * Same-origin proxy for the lead CSV.
 *
 * The browser cannot call the API directly — the access token lives in an
 * httpOnly cookie, which is the point of keeping it there — so the download has
 * to come through here.
 *
 * Only the filters the list itself understands are forwarded, by name. Passing
 * the query string through wholesale would let anything appended in the address
 * bar reach an endpoint that returns the caller's book; an allow-list means a
 * parameter has to be added here deliberately before it can travel.
 *
 * Whether the caller may export at all is decided by the API from their
 * permissions, and what they get is decided by their data scope. Neither is
 * checked here — a client-side check is a suggestion, not a rule.
 */
const FORWARDED = [
  'q',
  'status',
  'source',
  'productInterest',
  'priority',
  'ownerId',
  'owned',
  'capturedById',
  'captured',
  'eventId',
  'attendedEventId',
  'returningAtEventId',
  'campaignId',
  'partnerId',
  'overdueOnly',
  'minScore',
  'mobileVerified',
  'sortBy',
  'sortDir',
] as const;

export async function GET(request: Request): Promise<Response> {
  const token = await getAccessToken();
  if (!token) {
    return NextResponse.json({ title: 'Not signed in', status: 401 }, { status: 401 });
  }

  const incoming = new URL(request.url).searchParams;
  const params = new URLSearchParams();
  for (const key of FORWARDED) {
    // getAll, because products and statuses can repeat.
    for (const value of incoming.getAll(key)) {
      if (value) params.append(key, value);
    }
  }
  const suffix = params.toString() ? `?${params.toString()}` : '';

  const upstream = await fetch(`${API_BASE}/leads/export${suffix}`, {
    headers: { Authorization: `Bearer ${token}`, ...(await forwardedHeaders()) },
    cache: 'no-store',
  });

  if (!upstream.ok) {
    const problem: unknown = await upstream.json().catch(() => null);
    return NextResponse.json(problem ?? { title: 'The export could not be built' }, {
      status: upstream.status,
    });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="sihl-leads-${stamp}.csv"`,
      'X-Content-Type-Options': 'nosniff',
      // Never cached: the contents depend on who asked, and a shared cache
      // handing one person's scoped book to another is a reportable incident.
      'Cache-Control': 'private, no-store',
    },
  });
}
