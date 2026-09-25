import { NextResponse } from 'next/server';

import { forwardedHeaders } from '@/lib/forwarded';
import { getAccessToken } from '@/lib/session';
import { istDayKey } from '@/lib/time';

const API_BASE =
  process.env.API_INTERNAL_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';

/**
 * Same-origin proxy for the attendee CSV.
 *
 * The browser cannot call the API directly — the access token lives in an
 * httpOnly cookie, which is the point of keeping it there — so the download has
 * to come through here.
 *
 * Nothing is decided in this file. Whether the caller may export is decided by
 * the API from their permissions, and the file is audited there. A check here
 * would be a suggestion, not a rule.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slotId: string }> },
): Promise<Response> {
  const token = await getAccessToken();
  if (!token) {
    return NextResponse.json({ title: 'Not signed in', status: 401 }, { status: 401 });
  }

  const { slotId } = await params;

  const upstream = await fetch(`${API_BASE}/presentations/slots/${slotId}/attendees/export`, {
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
      'Content-Disposition': `attachment; filename="talk-attendees-${stamp}.csv"`,
      'X-Content-Type-Options': 'nosniff',
      // Never cached: it carries client contact details and depends on who
      // asked. A shared cache handing one person's file to another is a
      // reportable incident.
      'Cache-Control': 'private, no-store',
    },
  });
}
