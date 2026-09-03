import 'server-only';

import { randomUUID } from 'node:crypto';
import { cache } from 'react';
import { headers } from 'next/headers';

import { clientIpFrom } from './client-ip';

/**
 * Carries the caller's identity across the web → API hop.
 *
 * Every browser request stops at the Next server, which then calls the API
 * itself. That is deliberate — it keeps the access token in an httpOnly cookie
 * and means the API trusts exactly one origin. The side effect is that the API
 * sees the Next server as its caller, so without this two things that look
 * right in the code are silently wrong in production:
 *
 *   - `audit_log.ipAddress` recorded the Next server's egress address for every
 *     user and every action. A column that reads as evidence of where somebody
 *     acted from held the same value for the entire company.
 *   - The API middleware honours an inbound `x-request-id` specifically so a
 *     trace survives into its logs and audit rows. Nothing ever sent one, so a
 *     request could not be followed across the two services.
 */

/** Dedicated, so no proxy between the tiers can rewrite it the way XFF is. */
export const CLIENT_IP_HEADER = 'x-sihl-client-ip';
export const TRACE_HEADER = 'x-request-id';

/**
 * One id per inbound request, shared by every API call it makes.
 *
 * `cache` is per-request, so a page render that fans out into six API calls
 * files them all under one trace instead of six unrelated ones. If a runtime
 * ever fails to memoise this, the fallback is a distinct id per call — which is
 * exactly today's behaviour, so nothing regresses.
 */
const traceForThisRequest = cache(() => randomUUID());

/**
 * Headers to merge into an outbound API call.
 *
 * Never throws. `headers()` is unavailable outside a request scope — during a
 * build-time prerender, for instance — and a page must not fail to render
 * because the audit trail would have been slightly less complete.
 */
export async function forwardedHeaders(): Promise<Record<string, string>> {
  let incoming: Headers;
  try {
    incoming = await headers();
  } catch {
    return {};
  }

  const out: Record<string, string> = {};

  const ip = clientIpFrom(incoming);
  // 45 characters is the `audit_log.ipAddress` column, sized for IPv6.
  if (ip) out[CLIENT_IP_HEADER] = ip.slice(0, 45);

  // Honour a trace that already exists so an id set at the edge survives the
  // whole way down; mint one only when there is none.
  const inbound = incoming.get(TRACE_HEADER);
  out[TRACE_HEADER] = inbound && inbound.length <= 64 ? inbound : traceForThisRequest();

  return out;
}
