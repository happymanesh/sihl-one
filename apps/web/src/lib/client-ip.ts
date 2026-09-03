/**
 * Picking the caller's address out of the proxy headers.
 *
 * Kept apart from `forwarded.ts` so it carries no `server-only` marker and no
 * Next import, which makes the precedence below directly testable. That
 * precedence is the whole substance of the fix, so it is the part worth being
 * able to test.
 */
export function clientIpFrom(incoming: Headers): string | null {
  // Cloudflare sets this itself and discards any the client supplied, which
  // makes it the only one of the three that cannot be forged from a browser.
  const cf = incoming.get('cf-connecting-ip');
  if (cf?.trim()) return cf.trim();

  // Leftmost is the original client; each proxy appends its own to the right.
  const forwarded = incoming.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  if (first) return first;

  return incoming.get('x-real-ip')?.trim() || null;
}
