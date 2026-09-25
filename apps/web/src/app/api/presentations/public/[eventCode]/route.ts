import { NextResponse } from 'next/server';

const API_BASE =
  process.env.API_INTERNAL_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';

/**
 * The talks a visitor may still book.
 *
 * Proxied rather than called from the browser so the page stays same-origin:
 * the registration screen is loaded on a stranger's phone over a hall's wifi,
 * and a cross-origin request there is one more thing that can fail for reasons
 * nobody at the stall can diagnose.
 *
 * Unauthenticated, like the endpoint behind it. It returns only what is on the
 * schedule — no lead, no visitor, nothing about who is coming.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventCode: string }> },
): Promise<Response> {
  const { eventCode } = await params;

  const upstream = await fetch(
    `${API_BASE}/presentations/public/${encodeURIComponent(eventCode)}`,
    { cache: 'no-store' },
  );

  if (!upstream.ok) {
    // An empty schedule is the same answer as a closed one, deliberately. The
    // page has nothing to offer either way, and distinguishing them would let
    // anyone probe for events by trying codes.
    return NextResponse.json([], { status: 200 });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
