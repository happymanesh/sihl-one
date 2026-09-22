import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Throttle by the visitor, not by the web server.
 *
 * Every browser request stops at the Next server, which then calls the API
 * itself. The stock guard buckets by `req.ip`, which on that path is the web
 * container's address — the same value for every visitor in the country. One
 * shared counter then stands in for thousands of separate people, so a busy
 * minute locks everybody out at once and the limit stops describing anything
 * real.
 *
 * `x-sihl-client-ip` is the address the Next server resolved for the caller
 * before making the hop. It is dedicated rather than `x-forwarded-for`
 * precisely so no proxy in between rewrites it.
 *
 * It is only as trustworthy as the tier that set it, which is why nothing here
 * is a security control: a rate limit shapes load and slows down the clumsy. It
 * is not what stops a determined attacker, and it never was — the per-number
 * OTP cap, the duplicate check and the permission guards are.
 */
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const headers = (req.headers ?? {}) as Record<string, string | string[] | undefined>;
    const declared = headers['x-sihl-client-ip'];
    const value = Array.isArray(declared) ? declared[0] : declared;
    if (value && value.trim()) return value.trim();

    // No header: a direct caller, or an internal one. Fall back to what the
    // stock guard would have used.
    return typeof req.ip === 'string' && req.ip ? req.ip : 'unknown';
  }
}
