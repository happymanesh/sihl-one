import { NextResponse } from 'next/server';

import { getAccessToken } from '@/lib/session';
import { forwardedHeaders } from '@/lib/forwarded';

const API_BASE =
  process.env.API_INTERNAL_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  'http://localhost:4000/api/v1';

/**
 * Same-origin reverse-geocode proxy.
 *
 * Exists for the same reason the upload proxy does: the access token lives in
 * an httpOnly cookie the browser cannot read, so the camera cannot call the API
 * itself. The geocoding key never comes near the browser either — it stays on
 * the API, which is the point of proxying rather than calling Mappls directly
 * from the phone.
 *
 * Never returns an error status. The caller is a rep standing outside a
 * client's office with a camera open, and a missing address means the photo is
 * stamped with coordinates and a time instead. Failing loudly here would turn a
 * cosmetic gap into a blocked check-in.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const token = await getAccessToken();
  if (!token) return NextResponse.json({ address: null });

  const params = new URL(request.url).searchParams;
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ address: null });
  }

  try {
    const response = await fetch(`${API_BASE}/geo/reverse?lat=${lat}&lng=${lng}`, {
      headers: { Authorization: `Bearer ${token}`, ...(await forwardedHeaders()) },
      cache: 'no-store',
    });

    if (!response.ok) return NextResponse.json({ address: null });

    const body = (await response.json()) as { address?: string | null };
    return NextResponse.json({ address: body.address ?? null });
  } catch {
    return NextResponse.json({ address: null });
  }
}
