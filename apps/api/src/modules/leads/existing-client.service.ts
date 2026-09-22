import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

export interface ExistingClientMatch {
  known: boolean;
  clientCode: string | null;
}

const UNKNOWN: ExistingClientMatch = { known: false, clientCode: null };

/**
 * Is this number already a SIHL client?
 *
 * The back office is the real answer to that question and there is no interface
 * to it yet. Until there is, the answer comes from a table somebody maintains
 * by hand — which is a poor source of truth and an entirely adequate one for a
 * single event.
 *
 * The point of this class is that it is the *only* place that knows which. One
 * method, one call site. When the back office exposes an API, the body of
 * `lookup` becomes an HTTP call and nothing else in the codebase changes — no
 * hunting for the places that assumed a local table.
 *
 * Whoever writes that version should keep two properties this one has:
 *
 *  - **It never throws.** A capture at a stall must not fail because a lookup
 *    did. An unavailable back office means "not known", the registration
 *    completes, and the worst case is a rep greeting a client as a stranger —
 *    which is exactly today's behaviour, so the floor cannot drop below it.
 *  - **It never blocks for long.** Give the HTTP call a short timeout. A person
 *    is standing at a desk waiting for this form to submit.
 */
@Injectable()
export class ExistingClientService {
  private readonly logger = new Logger(ExistingClientService.name);

  constructor(private readonly prisma: PrismaService) {}

  async lookup(mobile: string): Promise<ExistingClientMatch> {
    try {
      const row = await this.prisma.knownClient.findFirst({
        where: { mobile, active: true },
        select: { clientCode: true },
      });
      return row ? { known: true, clientCode: row.clientCode } : UNKNOWN;
    } catch (error) {
      // Logged, not raised. See the note above: a registration that fails
      // because a lookup failed is a worse outcome than an unrecognised client.
      this.logger.warn(`Existing-client lookup failed: ${String(error)}`);
      return UNKNOWN;
    }
  }
}
