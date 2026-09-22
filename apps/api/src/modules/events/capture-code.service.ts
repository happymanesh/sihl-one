import { Injectable, NotFoundException } from '@nestjs/common';
import {
  eventAcceptsCaptures,
  type CaptureContext,
  type CaptureProduct,
  type EventStatus,
} from '@sihl-one/contracts';

import { hasEventAccess } from '../../common/event-access';
import { PrismaService } from '../../prisma/prisma.service';

export interface ResolvedCapture {
  partnerId: string | null;
  eventId: string | null;
  campaignId: string | null;
  /** Where the lead should land, when the code names an owner. */
  suggestedOwnerId: string | null;
  /**
   * The branch or region the capture belongs to.
   *
   * Carried separately from the owner because a lead can have one without the
   * other. An unowned lead still has to be *findable*: the data scopes match a
   * lead either by who owns it or by its place in the org tree, so a lead with
   * neither is visible to nobody but a super admin. Recording where it came in
   * is what keeps an unclaimed registration on the branch's screen.
   */
  orgUnitId: string | null;
  /** The rep whose personal QR was scanned, when one was and it checks out. */
  capturedById: string | null;
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
        products: await this.activeProducts(),
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
      products: await this.activeProducts(),
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
   * The rep behind a personal QR, or null.
   *
   * The employee code arrives on a public URL that anybody can retype, so it is
   * a claim and nothing more. Three things have to hold before it is honoured:
   * the code names a live account, that person actually has event access, and
   * the event belongs to their own branch or one above it.
   *
   * Together those stop the obvious abuse — editing a colleague's code into the
   * address bar to take credit for their stall — without ever refusing the
   * lead. A code that fails any check is simply ignored: the capture proceeds
   * unattributed, because a real person filling in a real form must never be
   * lost to a bad parameter.
   *
   * It is not airtight, and cannot be while the link is public and the codes
   * are short. Two reps at the same stall can still claim each other's scans.
   * The audit trail records what was submitted, which is the realistic control.
   */
  private async resolveRep(
    repCode: string | undefined,
    eventOrgUnitId: string | null,
  ): Promise<string | null> {
    const code = repCode?.trim();
    if (!code) return null;

    const rep = await this.prisma.user.findFirst({
      where: {
        employeeCode: { equals: code, mode: 'insensitive' },
        deletedAt: null,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        designationId: true,
        orgUnitId: true,
        orgUnit: { select: { path: true } },
      },
    });
    if (!rep) return null;

    if (!(await hasEventAccess(this.prisma, rep))) return null;

    // The event must sit in this rep's own chain. An event with no org unit is
    // a national one and belongs to everybody.
    if (eventOrgUnitId) {
      const chain = (rep.orgUnit?.path ?? '').split('/').filter(Boolean);
      if (!chain.includes(eventOrgUnitId)) return null;
    }

    return rep.id;
  }

  /**
   * Active products, for the public form.
   *
   * The capture page is unauthenticated, so it cannot call the masters
   * endpoint; sending the list with the context keeps the public surface to the
   * one route that already exists.
   */
  private async activeProducts(): Promise<CaptureProduct[]> {
    const rows = await this.prisma.product.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        parentId: true,
        summary: true,
        parent: { select: { name: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      parentId: row.parentId,
      parentName: row.parent?.name ?? null,
      summary: row.summary,
    }));
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
    /** Employee code from the rep's personal QR, straight off the query string. */
    repCode?: string;
  }): Promise<ResolvedCapture> {
    const empty: ResolvedCapture = {
      partnerId: null,
      eventId: null,
      campaignId: null,
      suggestedOwnerId: null,
      capturedById: null,
      orgUnitId: null,
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
          orgUnitId: true,
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
        const rep = await this.resolveRep(input.repCode, event.orgUnitId);

        return {
          ...empty,
          eventId: event.id,
          campaignId: event.campaignId,
          capturedById: rep,
          /*
            A personal QR names its rep as the owner. The common QR names
            nobody.

            It used to fall back to the event's owner so nothing sat unclaimed
            over a weekend, but that made every walk-up the property of one
            person who never asked for it and often never saw it — and it meant
            the stall's registrations could not be handed out, because they were
            already owned. Leaving them unowned is what makes distributing them
            a decision somebody takes rather than one the QR took for them.
          */
          suggestedOwnerId: rep,
          // Unowned, but not invisible: the branch the event belongs to still
          // sees it, and that is the only reason an unclaimed lead reaches
          // anybody at all.
          orgUnitId: event.orgUnitId,
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
