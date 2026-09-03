import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { RequestContextStore } from '../request-context';

/**
 * Establishes the per-request context and the trace id.
 *
 * An inbound `x-request-id` is honoured so a trace started at the gateway (or
 * in the browser) survives into the API's logs and audit rows. That is what
 * makes "the user says it broke at 14:32" a solvable problem.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const inbound = req.headers['x-request-id'];
    const traceId =
      (typeof inbound === 'string' && inbound.length <= 64 && inbound) ||
      RequestContextStore.newTraceId();

    res.setHeader('x-request-id', traceId);

    RequestContextStore.run(
      {
        traceId,
        ipAddress: this.clientIp(req),
        userAgent: req.headers['user-agent'],
      },
      () => next(),
    );
  }

  /**
   * Behind a load balancer `req.ip` is the balancer. `trust proxy` is enabled
   * in main.ts so Express resolves X-Forwarded-For itself; the manual fallback
   * covers direct connections in development.
   *
   * `x-sihl-client-ip` is preferred over both. Almost every request reaching
   * this API comes from the Next server rather than a browser — that is the
   * whole point of keeping the access token in an httpOnly cookie — so without
   * it, X-Forwarded-For describes the hop between our own two services and
   * every audit row in the system records the same address.
   *
   * It is trusted on the same terms as X-Forwarded-For already is: this service
   * is publicly reachable, so a caller holding a valid token could set either
   * one by hand. That is not a regression, and the alternative on offer is not
   * a trustworthy IP but no IP at all.
   */
  private clientIp(req: Request): string | undefined {
    const declared = req.headers['x-sihl-client-ip'];
    if (typeof declared === 'string' && declared.trim()) return declared.trim().slice(0, 45);

    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') return forwarded.split(',')[0]?.trim();
    return req.ip ?? req.socket.remoteAddress ?? undefined;
  }
}
