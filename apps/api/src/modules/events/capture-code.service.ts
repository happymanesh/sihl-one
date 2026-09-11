import { Injectable, NotFoundException } from '@nestjs/common';
import { eventAcceptsCaptures, type CaptureContext, type EventStatus } from '@sihl-one/contracts';

import { PrismaService } from '../../prisma/prisma.service';

export interface ResolvedCapture {
  partnerId: string | null;
  eventId: string | null;
  campaignId: string | null;
  /** Where the lead should land, when the code names an owner. */
  suggestedOwnerId: string | null;
  source: 'PARTNER' | 'REFERRAL' | 'BRANCH_EVENT' | null;
}

/**
 * Resolves the codes on a public capture link.
 *
 * Everything here takes a **code** and returns ids. Nothing takes an id. The
 * capture endpoint is unauthenticated by design — a prospective client filling
 * in a form has no account — so accepting a `partnerId` from the browser would
 * let anyone on the internet attribute someone else's business to themselves,
 * and the only trace would be a perfectly ordinary-looking lead.
 *
 * A code that resolves to nothing is not an error at capture time. The lead is
 * a real person who really filled in a form; losing them because a banner was
 * printed with last year's code is a far worse outcome than an unattributed
 * lead. The public *page* does say clearly when a code is unrecognised, so the
 * problem surfaces before anyone types.
 */
@Injectable()
export class CaptureCodeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * What the public page needs before it renders — who the capture is for, and
   * whether it is open. Throws only when the code is unknown, so the page can
   * say so plainly instead of silently collecting an orphan lead.
   */
  async context(kind: 'PARTNER' | 'EVENT', code: string): Promise<CaptureContext> {
    if (kind === 'PARTNER') {
      const partner = await this.prisma.partner.findFirst({
        where: { referralCode: { equals: code, mode: 'insensitive' }, deletedAt: null },
        select: { name: true, status: true },
      });
      if (!partner) throw new NotFoundException({ title: 'Unknown referral code' });

      const active = partner.status === 'ACTIVE';
      return {
        kind: 'PARTNER',
        code,
        attributedTo: partner.name,
        acceptingSubmissions: active,
        closedReason: active
          ? null
          : 'This referral link is no longer active. Please contact your advisor.',
      };
    }

    const event = await this.prisma.event.findFirst({
      where: { code: code.toLowerCase(), deletedAt: null },
      select: { name: true, status: true, venue: true, startsAt: true, endsAt: true },
    });
    if (!event) throw new NotFoundException({ title: 'Unknown event code' });

    const open = eventAcceptsCaptures(event.status as EventStatus, {
      startsAt: event.startsAt,
      endsAt: event.endsAt,
    });
    return {
      kind: 'EVENT',
      code,
      attributedTo: event.name,
      eventName: event.name,
      venue: event.venue,
      startsAt: event.startsAt.toISOString(),
      acceptingSubmissions: open,
      closedReason: open
        ? null
        : event.status === 'PLANNED' && event.startsAt > new Date()
          ? 'This event has not started yet. Please scan again on the day.'
          : 'This event has ended. You can still open an account on our website.',
    };
  }

  /**
   * Resolves both codes on a submission.
   *
   * Runs again at submit time rather than trusting whatever the page resolved
   * when it rendered — the two are minutes apart, and only this one counts.
   */
  async resolve(input: {
    partnerCode?: string;
    eventCode?: string;
  }): Promise<ResolvedCapture> {
    const empty: ResolvedCapture = {
      partnerId: null,
      eventId: null,
      campaignId: null,
      suggestedOwnerId: null,
      source: null,
    };

    if (input.partnerCode) {
      const partner = await this.prisma.partner.findFirst({
        where: {
          referralCode: { equals: input.partnerCode, mode: 'insensitive' },
          deletedAt: null,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      if (partner) {
        return { ...empty, partnerId: partner.id, source: 'PARTNER' };
      }
    }

    if (input.eventCode) {
      const event = await this.prisma.event.findFirst({
        where: { code: input.eventCode.toLowerCase(), deletedAt: null },
        select: {
          id: true,
          status: true,
          ownerId: true,
          campaignId: true,
          startsAt: true,
          endsAt: true,
        },
      });

      // A capture against an event that is not running is still recorded, but
      // without the event attribution — otherwise a stale QR quietly inflates
      // last quarter's event report months after it closed.
      if (
        event &&
        eventAcceptsCaptures(event.status as EventStatus, {
          startsAt: event.startsAt,
          endsAt: event.endsAt,
        })
      ) {
        return {
          ...empty,
          eventId: event.id,
          campaignId: event.campaignId,
          suggestedOwnerId: event.ownerId,
          // BRANCH_EVENT, not WALK_IN. Both are seeded and active, and the
          // difference matters in every report: a QR scanned at a stall and
          // somebody wandering into a branch are different acquisition
          // channels, and filing them together made event spend impossible to
          // judge against anything.
          source: 'BRANCH_EVENT',
        };
      }
    }

    return empty;
  }
}
