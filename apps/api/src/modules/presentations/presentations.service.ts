import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  maskMobile,
  type BookPresentationInput,
  type CreatePresentationSlotInput,
  type PresentationAttendee,
  type PresentationBookingResult,
  type PresentationDay,
  type PresentationSlotSummary,
  type UpdatePresentationSlotInput,
} from '@sihl-one/contracts';

import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { istDayKey } from '../../common/ist-day';
import { Mailer } from '../mail/mailer';
import { escapeHtml } from '../mail/password-reset.template';

/**
 * One CSV cell.
 *
 * A leading =, +, - or @ makes Excel treat the value as a formula, so a visitor
 * called "=cmd" would execute on open. Prefixing an apostrophe is the standard
 * defence and is invisible in the cell.
 */
function csvCell(value: string): string {
  const risky = /^[=+\-@\t\r]/.test(value);
  const text = risky ? `'${value}` : value;
  return `"${text.replace(/"/g, '""')}"`;
}

/** YYYY-MM-DD in the business timezone, for comparing which day something falls on. */
const IST_DAY_KEY = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'Asia/Kolkata',
});

/** "Fri 26 Sep" and "14:30", in the timezone the events are run in. */
const IST_DAY = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'Asia/Kolkata',
});
const IST_CLOCK = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'Asia/Kolkata',
});

/** A booking token outlives the acknowledgement screen and little else. */
const BOOKING_TOKEN_TTL_SECONDS = 30 * 60;

/**
 * The one invitation that replaces eight brochure listings.
 *
 * Kept as constants because the text and the HTML both use them and the two
 * must not drift. Written for a prospect who has just met us at a stall: it says
 * what is behind the link and what it covers, and promises nothing about
 * returns — a SEBI-registered broker does not, and a reader who has heard that
 * promise from everybody else trusts the one who does not make it.
 */
const BROCHURE_HEADING = 'Explore our full range of solutions';
const BROCHURE_CAPTION =
  'From everyday trading to long-term wealth, global investing and our partner programme — every brochure in one place, written for people who want the detail.';

/** What both renderings of the confirmation are built from. */
interface ConfirmationInput {
  firstName: string;
  eventName: string;
  venue: string | null;
  slots: Array<{ startsAt: Date; topic: string; durationMinutes: number }>;
}

@Injectable()
export class PresentationsService {
  private readonly logger = new Logger(PresentationsService.name);
  private readonly bookingSecret: string;
  private readonly brochureBaseUrl: string;
  private readonly support: { phone: string; email: string };

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
    private readonly mail: Mailer,
    config: ConfigService,
  ) {
    this.bookingSecret = `${config.get<string>('JWT_SECRET') ?? ''}:presentation-booking`;
    this.brochureBaseUrl =
      config.get<string>('BROCHURE_BASE_URL') ??
      `${config.get<string>('PUBLIC_WEB_URL') ?? ''}/brochures`;
    this.support = {
      phone: config.get<string>('SUPPORT_PHONE') ?? '079-6508-1699',
      email: config.get<string>('SUPPORT_EMAIL') ?? 'helpdesk@sihl.in',
    };
  }

  // ---------------------------------------------------------------------------
  // Who is allowed to book
  // ---------------------------------------------------------------------------

  /**
   * A pass for the visitor who just proved their number.
   *
   * Issued in two places, because there are two ways to arrive at the
   * acknowledgement screen having proved a number: entering a code just now, or
   * having proved it at an earlier event and being sent no code at all. The
   * second is a returning client — exactly the person most worth a seat — and a
   * token tied to the OTP row would have shut them out.
   *
   * Signed rather than stored: it carries one lead id for half an hour, and a
   * table would need its own cleanup for no gain.
   */
  async issueBookingToken(leadId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: leadId, purpose: 'presentation_booking' },
      { secret: this.bookingSecret, expiresIn: BOOKING_TOKEN_TTL_SECONDS },
    );
  }

  /**
   * A pass, if this person is entitled to one.
   *
   * Identity only: it says the number behind this lead has been proven, and
   * nothing about which event or which talks. That separation matters because
   * a returning visitor's `lead.eventId` still points at the event that first
   * produced them, not the stall they are standing at — gating the token on it
   * would hand out passes for the wrong event and withhold them for the right
   * one. Which talks are on offer is decided where the talks are read.
   */
  async bookingTokenFor(leadId: string): Promise<string | null> {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { mobileVerifiedAt: true },
    });
    if (!lead?.mobileVerifiedAt) return null;
    return this.issueBookingToken(leadId);
  }

  private async leadFromToken(token: string): Promise<string> {
    try {
      const claims = await this.jwt.verifyAsync<{ sub: string; purpose?: string }>(token, {
        secret: this.bookingSecret,
      });
      if (claims.purpose !== 'presentation_booking' || !claims.sub)
        throw new Error('wrong purpose');
      return claims.sub;
    } catch {
      throw new UnauthorizedException({
        title: 'That booking session has expired',
        detail: 'Register again at the stall to book a seat.',
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  /** Every slot on an event, past and cancelled included. For the admin screens. */
  async schedule(eventId: string): Promise<PresentationDay[]> {
    const slots = await this.prisma.presentationSlot.findMany({
      where: { eventId },
      orderBy: { startsAt: 'asc' },
      include: { _count: { select: { bookings: true } } },
    });
    return this.groupByDay(slots.map((slot) => this.toSummary(slot)));
  }

  /**
   * What a visitor may still book.
   *
   * Cancelled slots are gone, and so is anything that has already started —
   * a talk at 2pm stops being offered at 2pm. Nothing here is capped by
   * `capacity`; the column is recorded but not yet enforced.
   */
  async bookable(eventId: string): Promise<PresentationDay[]> {
    const slots = await this.prisma.presentationSlot.findMany({
      where: { eventId, isActive: true, startsAt: { gt: new Date() } },
      orderBy: { startsAt: 'asc' },
      include: { _count: { select: { bookings: true } } },
    });
    return this.groupByDay(slots.map((slot) => this.toSummary(slot)));
  }

  /**
   * The same schedule, found by the code on the QR.
   *
   * The public page never learns an id. It has the code the visitor scanned,
   * and that is all it should need — an id in a public URL invites walking the
   * list of events.
   */
  async bookableByCode(eventCode: string): Promise<PresentationDay[]> {
    const event = await this.prisma.event.findFirst({
      where: { code: eventCode, deletedAt: null },
      select: { id: true, allowsPresentationBooking: true },
    });
    // An unknown code and a closed schedule answer the same way. Saying which
    // would let anyone on the internet probe for events by trying codes.
    if (!event || !event.allowsPresentationBooking) return [];
    return this.bookable(event.id);
  }

  /** Who booked a given talk. */
  async attendees(slotId: string): Promise<PresentationAttendee[]> {
    const rows = await this.prisma.presentationBooking.findMany({
      where: { slotId },
      orderBy: { createdAt: 'asc' },
      select: {
        createdAt: true,
        lead: {
          select: {
            id: true,
            reference: true,
            firstName: true,
            lastName: true,
            mobile: true,
            email: true,
          },
        },
      },
    });

    return rows.map((row) => ({
      leadId: row.lead.id,
      reference: row.lead.reference,
      fullName: `${row.lead.firstName} ${row.lead.lastName ?? ''}`.trim(),
      // Masked, for the same reason the lead list masks: a screenful of numbers
      // is the easiest bulk leak there is. The export carries them in full.
      mobileMasked: maskMobile(row.lead.mobile),
      email: row.lead.email,
      bookedAt: row.createdAt.toISOString(),
    }));
  }

  /**
   * The attendee list as a CSV.
   *
   * Numbers are unmasked here, unlike the screen: a list nobody can ring is no
   * use to the person running the talk. The export is audited for that reason.
   */
  async attendeesCsv(slotId: string): Promise<{ csv: string; rows: number }> {
    const slot = await this.prisma.presentationSlot.findUnique({
      where: { id: slotId },
      select: { topic: true, startsAt: true },
    });
    if (!slot) throw new NotFoundException({ title: 'No such talk' });

    const rows = await this.prisma.presentationBooking.findMany({
      where: { slotId },
      orderBy: { createdAt: 'asc' },
      select: {
        createdAt: true,
        lead: {
          select: {
            reference: true,
            firstName: true,
            lastName: true,
            mobile: true,
            email: true,
            city: true,
          },
        },
      },
    });

    const header = ['Reference', 'Name', 'Mobile', 'Email', 'City', 'Booked at', 'Talk'];
    const body = rows.map((row) => [
      row.lead.reference,
      `${row.lead.firstName} ${row.lead.lastName ?? ''}`.trim(),
      row.lead.mobile,
      row.lead.email ?? '',
      row.lead.city ?? '',
      row.createdAt.toISOString(),
      slot.topic,
    ]);

    const csv =
      '\uFEFF' + [header, ...body].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';

    return { csv, rows: rows.length };
  }

  // ---------------------------------------------------------------------------
  // Writes — the desk
  // ---------------------------------------------------------------------------

  /**
   * Open or close the schedule to visitors.
   *
   * Audited, because closing it makes every talk vanish from the picker at
   * once while the seats already taken stay on the books. Somebody will want
   * to know when that happened and who did it.
   */
  async setBookingEnabled(eventId: string, enabled: boolean): Promise<{ enabled: boolean }> {
    await this.mustFindEvent(eventId);
    const event = await this.prisma.event.update({
      where: { id: eventId },
      data: { allowsPresentationBooking: enabled },
      select: { allowsPresentationBooking: true },
    });

    await this.audit.record({
      action: 'UPDATE',
      resource: 'event.presentationBooking',
      resourceId: eventId,
      changes: { enabled: event.allowsPresentationBooking },
    });

    return { enabled: event.allowsPresentationBooking };
  }

  async createSlot(userId: string, eventId: string, input: CreatePresentationSlotInput) {
    const event = await this.mustFindEvent(eventId);
    this.assertWithinEvent(event, input.startsAt);

    const slot = await this.prisma.presentationSlot.create({
      data: {
        eventId,
        startsAt: input.startsAt,
        durationMinutes: input.durationMinutes,
        topic: input.topic,
        presenterName: input.presenterName ?? null,
        capacity: input.capacity ?? null,
        createdById: userId,
      },
      include: { _count: { select: { bookings: true } } },
    });

    await this.audit.record({
      action: 'CREATE',
      resource: 'event.slot',
      resourceId: slot.id,
      changes: { eventId, topic: slot.topic, startsAt: slot.startsAt.toISOString() },
    });

    return this.toSummary(slot);
  }

  async updateSlot(slotId: string, input: UpdatePresentationSlotInput) {
    const existing = await this.prisma.presentationSlot.findUnique({
      where: { id: slotId },
      select: { id: true, eventId: true, startsAt: true },
    });
    if (!existing) throw new NotFoundException({ title: 'No such talk' });

    if (input.startsAt) {
      const event = await this.mustFindEvent(existing.eventId);
      this.assertWithinEvent(event, input.startsAt);
    }

    const slot = await this.prisma.presentationSlot.update({
      where: { id: slotId },
      data: {
        startsAt: input.startsAt,
        durationMinutes: input.durationMinutes,
        topic: input.topic,
        presenterName: input.presenterName,
        capacity: input.capacity,
        isActive: input.isActive,
      },
      include: { _count: { select: { bookings: true } } },
    });

    await this.audit.record({
      action: 'UPDATE',
      resource: 'event.slot',
      resourceId: slot.id,
      // Recorded because switching a talk off leaves people holding seats for
      // something that is not happening, and somebody has to ring them.
      changes: { isActive: slot.isActive, registered: slot._count.bookings },
    });

    return this.toSummary(slot);
  }

  // ---------------------------------------------------------------------------
  // Writes — the visitor
  // ---------------------------------------------------------------------------

  /**
   * Book seats, from the acknowledgement screen.
   *
   * Every slot asked for is re-checked here rather than trusted from the page:
   * the picker was rendered minutes ago, and a talk can start, fill or be
   * cancelled in between. Anything no longer bookable is skipped and counted,
   * never silently treated as booked.
   */
  async book(input: BookPresentationInput): Promise<PresentationBookingResult> {
    const leadId = await this.leadFromToken(input.bookingToken);

    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        email: true,
        firstName: true,
        productInterest: true,
        mobileVerifiedAt: true,
      },
    });
    if (!lead) throw new NotFoundException({ title: 'No such registration' });

    // The token proves the holder passed verification, but the lead is the
    // record of it. Both have to agree.
    if (!lead.mobileVerifiedAt) {
      throw new BadRequestException({
        title: 'Confirm your mobile number first',
        detail: 'A seat can only be held against a confirmed number.',
      });
    }

    const slots = await this.prisma.presentationSlot.findMany({
      where: {
        id: { in: input.slotIds },
        isActive: true,
        startsAt: { gt: new Date() },
        // The event's own switch counts here too, not only in the picker. The
        // list was rendered minutes ago and booking can be closed in between.
        event: { allowsPresentationBooking: true },
      },
      orderBy: { startsAt: 'asc' },
    });

    const event =
      slots.length > 0
        ? await this.prisma.event.findUnique({
            where: { id: slots[0]!.eventId },
            select: { name: true, venue: true },
          })
        : null;
    const eventName = event?.name ?? '';
    const venue = event?.venue ?? null;

    if (slots.length > 0) {
      await this.prisma.presentationBooking.createMany({
        data: slots.map((slot) => ({ slotId: slot.id, leadId: lead.id })),
        // The same person tapping submit twice is the ordinary case at a stall.
        skipDuplicates: true,
      });
    }

    // An email given here is the one moment a visitor who skipped it at
    // registration will part with it, so it is kept on the lead rather than
    // used once and thrown away.
    const email = input.email ?? lead.email;
    if (input.email && input.email !== lead.email) {
      await this.prisma.lead.update({
        where: { id: lead.id },
        data: { email: input.email },
      });
    }

    /*
      The confirmation.

      Sent through the same MessageSender every other outbound message uses, so
      wiring a provider lights this up along with everything else. Until one is
      wired the default records and sends nothing, and `emailed` says so — a
      screen that claims a confirmation which never left is worse than one that
      admits it.

      A failure here never fails the booking. The seat is already held; the
      person is standing at a desk, and losing their booking because a mail
      provider was slow would be the wrong trade.
    */
    let emailed = false;
    if (email && slots.length > 0) {
      try {
        const confirmation: ConfirmationInput = {
          firstName: lead.firstName,
          eventName,
          venue,
          slots,
        };
        const result = await this.mail.send({
          to: email,
          subject: `Your seat is booked${eventName ? ` — ${eventName}` : ''}`,
          text: this.confirmationText(confirmation),
          html: this.confirmationHtml(confirmation),
        });
        // Both mailers report honestly — the noop one returns accepted: false
        // rather than claiming a message that never left the building.
        emailed = result.accepted;
        if (!result.accepted) {
          this.logger.warn(
            `Booking confirmation not sent: ${result.failureReason ?? 'no reason given'}`,
          );
        }
      } catch (error) {
        this.logger.warn(`Booking confirmation not sent: ${String(error)}`);
      }
    }

    return {
      booked: slots.map((slot) => ({
        slotId: slot.id,
        startsAt: slot.startsAt.toISOString(),
        topic: slot.topic,
        presenterName: slot.presenterName,
        durationMinutes: slot.durationMinutes,
      })),
      skipped: input.slotIds.length - slots.length,
      emailed,
    };
  }

  /**
   * The confirmation, as a table of talks and one link.
   *
   * Two things changed here on request, and both are about what the reader
   * actually uses. The presenter's name is gone — it is a name they have never
   * heard, sitting beside the time they have to remember, and it is the field on
   * a talk most likely to change after this email is sent. And the brochures are
   * no longer listed one by one: eight titles with descriptions and eight
   * separate links buried the booking, so they are one link to the page that
   * holds all of them, which also means a brochure can be added or replaced
   * without anybody's inbox going stale.
   *
   * Text and HTML are built separately rather than one derived from the other.
   * A real `table` cannot survive being reconstructed from plain text, and the
   * columns are the point. They are built from the same input in the same order,
   * a few lines apart, so they still say the same thing.
   */
  private confirmationText(input: ConfirmationInput): string {
    /*
      Columns in plain text, padded to the widest value.

      A monospaced client lines these up exactly; a proportional one lines them
      up roughly, which still reads as a table and is better than a sentence.
      The HTML part is what most people will see.
    */
    const when = input.slots.map(
      (slot) => `${IST_DAY.format(slot.startsAt)} ${IST_CLOCK.format(slot.startsAt)}`,
    );
    const whenWidth = Math.max(4, ...when.map((value) => value.length));
    const topicWidth = Math.max(5, ...input.slots.map((slot) => slot.topic.length));

    const rows = input.slots.map(
      (slot, index) =>
        `${when[index].padEnd(whenWidth)}  ${slot.topic.padEnd(topicWidth)}  ${
          slot.durationMinutes
        } min`,
    );

    return [
      `Dear ${input.firstName},`,
      '',
      'Your seat is confirmed.',
      '',
      `${'When'.padEnd(whenWidth)}  ${'Topic'.padEnd(topicWidth)}  Duration`,
      `${'-'.repeat(whenWidth)}  ${'-'.repeat(topicWidth)}  --------`,
      ...rows,
      '',
      ...(input.venue ? [`Venue: ${input.venue}`, ''] : []),
      'Please arrive a few minutes early and show this email at the desk.',
      '',
      BROCHURE_HEADING,
      BROCHURE_CAPTION,
      this.brochureBaseUrl,
      '',
      `If anything changes, or you would like to speak to someone before the session, call us on ${this.support.phone} or write to ${this.support.email}.`,
      '',
      'Regards,',
      'Shah Investors Home Ltd',
      '',
      '---',
      `Sent because you booked a seat at ${input.eventName}. Reply to this email if you would rather not hear from us.`,
    ].join('\n');
  }

  /**
   * The same confirmation as HTML.
   *
   * Table-based layout with inline styles and no stylesheet, because that is the
   * only thing every mail client renders the same way. The palette and spacing
   * follow the password-reset template so the two do not look like they came
   * from different companies.
   */
  private confirmationHtml(input: ConfirmationInput): string {
    const rows = input.slots
      .map(
        (slot) => `
            <tr>
              <td style="padding:10px 12px;border-top:1px solid #e3e6ea;white-space:nowrap;font-weight:600;">
                ${escapeHtml(IST_DAY.format(slot.startsAt))}<br>
                <span style="font-size:17px;">${escapeHtml(IST_CLOCK.format(slot.startsAt))}</span>
              </td>
              <td style="padding:10px 12px;border-top:1px solid #e3e6ea;">${escapeHtml(
                slot.topic,
              )}</td>
              <td style="padding:10px 12px;border-top:1px solid #e3e6ea;white-space:nowrap;color:#52606d;" align="right">${
                slot.durationMinutes
              } min</td>
            </tr>`,
      )
      .join('');

    // The heading row is the highlighted one that was asked for: the house navy
    // with white text, so the three columns are unmistakably a table and not
    // three stacked sentences.
    const head =
      '<th align="left" style="padding:9px 12px;background:#0f2e5c;color:#ffffff;' +
      'font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">';

    const brochureUrlHtml = escapeHtml(this.brochureBaseUrl);

    return `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#f4f5f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;border:1px solid #e3e6ea;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2933;">
        <tr><td style="padding:22px 24px 0;">
          <p style="margin:0;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0f2e5c;">Shah Investors Home Ltd</p>
          <h1 style="margin:10px 0 0;font-size:20px;line-height:1.3;font-weight:700;">Your seat is confirmed</h1>
          <p style="margin:12px 0 0;font-size:15px;line-height:1.6;">Dear ${escapeHtml(
            input.firstName,
          )},</p>
        </td></tr>

        <tr><td style="padding:16px 24px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e3e6ea;border-radius:6px;font-size:15px;">
            <tr>
              ${head}When</th>
              ${head}Topic</th>
              <th align="right" style="padding:9px 12px;background:#0f2e5c;color:#ffffff;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Duration</th>
            </tr>${rows}
          </table>
        </td></tr>
${
  input.venue
    ? `
        <tr><td style="padding:14px 24px 0;font-size:15px;line-height:1.6;">
          <span style="color:#52606d;">Venue</span><br>
          <strong>${escapeHtml(input.venue)}</strong>
        </td></tr>`
    : ''
}
        <tr><td style="padding:14px 24px 0;font-size:15px;line-height:1.6;">
          <p style="margin:0;">Please arrive a few minutes early and show this email at the desk.</p>
        </td></tr>

        <tr><td style="padding:20px 24px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f9fc;border:1px solid #cfd8e3;border-radius:6px;">
            <tr><td style="padding:16px 18px;font-size:15px;line-height:1.6;">
              <p style="margin:0;font-weight:700;">${escapeHtml(BROCHURE_HEADING)}</p>
              <p style="margin:6px 0 14px;color:#52606d;">${escapeHtml(BROCHURE_CAPTION)}</p>
              <a href="${brochureUrlHtml}" style="display:inline-block;background:#0f2e5c;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:10px 22px;border-radius:6px;">View all brochures</a>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:18px 24px 0;font-size:15px;line-height:1.6;">
          <p style="margin:0;">If anything changes, or you would like to speak to someone before the session, call us on <strong>${escapeHtml(
            this.support.phone,
          )}</strong> or write to <a href="mailto:${escapeHtml(
            this.support.email,
          )}" style="color:#0f2e5c;">${escapeHtml(this.support.email)}</a>.</p>
          <p style="margin:14px 0 0;">Regards,<br>Shah Investors Home Ltd</p>
        </td></tr>

        <tr><td style="padding:18px 24px 22px;">
          <p style="margin:0;padding-top:14px;border-top:1px solid #e3e6ea;font-size:12px;line-height:1.6;color:#7b8794;">
            Sent because you booked a seat at ${escapeHtml(
              input.eventName,
            )}. Reply to this email if you would rather not hear from us.<br>
            Investments in securities markets are subject to market risks. Read all the related documents carefully before investing.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async mustFindEvent(eventId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, deletedAt: null },
      select: { id: true, startsAt: true, endsAt: true },
    });
    if (!event) throw new NotFoundException({ title: 'No such event' });
    return event;
  }

  /**
   * A talk has to happen while the event is on.
   *
   * The end date is optional on an event, so a missing one is treated as the
   * end of its opening day — the same rule the capture window already uses,
   * rather than a second definition of how long an event lasts.
   */
  private assertWithinEvent(event: { startsAt: Date; endsAt: Date | null }, startsAt: Date): void {
    const end = event.endsAt ?? new Date(event.startsAt.getTime() + 86_400_000);

    /*
      Compared as calendar days in the business timezone, not as instants.

      Two reasons. The human one: "the talk has to be on a day the event runs"
      is what somebody at a desk means, and a talk at 09:55 on the opening
      morning is not outside an event that opens at 10:00 — it is a typo they
      will fix, not a rejection they need.

      The mechanical one: events and slots do not agree about what a stored
      time means. An event's start was captured from a form that carried no
      timezone, so it holds the wall-clock figure somebody typed; a slot now
      carries a real instant. Comparing those directly rejects perfectly good
      morning slots by five and a half hours. Comparing the day each falls on
      is true under either reading.
    */
    const day = (value: Date): string => IST_DAY_KEY.format(value);
    const slotDay = day(startsAt);
    if (slotDay < day(event.startsAt) || slotDay > day(end)) {
      throw new BadRequestException({
        title: 'That time is outside the event',
        detail: 'A talk has to start between the event’s own start and end.',
      });
    }
  }

  private toSummary(slot: {
    id: string;
    startsAt: Date;
    durationMinutes: number;
    topic: string;
    presenterName: string | null;
    capacity: number | null;
    isActive: boolean;
    _count: { bookings: number };
  }): PresentationSlotSummary {
    return {
      id: slot.id,
      startsAt: slot.startsAt.toISOString(),
      durationMinutes: slot.durationMinutes,
      topic: slot.topic,
      presenterName: slot.presenterName,
      capacity: slot.capacity,
      isActive: slot.isActive,
      registered: slot._count.bookings,
    };
  }

  /** YYYY-MM-DD in the business timezone, then grouped in order. */
  private groupByDay(slots: PresentationSlotSummary[]): PresentationDay[] {
    const days = new Map<string, PresentationSlotSummary[]>();
    for (const slot of slots) {
      const date = istDayKey(new Date(slot.startsAt));
      (days.get(date) ?? days.set(date, []).get(date)!).push(slot);
    }
    return [...days.entries()]
      .map(([date, entries]) => ({ date, slots: entries }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
}
