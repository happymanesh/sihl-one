import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  OTP_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_SENDS_PER_HOUR,
  OTP_TTL_MINUTES,
  maskMobile,
  renderEventRegistrationMessage,
  renderOtpMessage,
  type OtpChallenge,
  type OtpPurpose,
  type OtpVerifyResult,
} from '@sihl-one/contracts';

import { APP_CONFIG, type AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { PresentationsService } from '../presentations/presentations.service';
import { SmsSender } from '../messaging/sms-sender';

/**
 * One-time codes for proving a mobile number.
 *
 * The order of operations matters and is the thing to preserve: the lead is
 * written and committed **before** a code is issued or a message sent. A person
 * who fills in a form at a stall and then loses signal, mistypes their number or
 * simply walks away is still somebody who was interested, and losing them
 * because an SMS gateway was slow would be the worst possible trade.
 *
 * Verification is therefore an improvement to a record that already exists,
 * never a gate on creating one.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly sms: SmsSender,
    private readonly presentations: PresentationsService,
  ) {}

  /**
   * Hashed, never stored in clear.
   *
   * SHA-256 without a salt is deliberate and adequate here, unlike for a
   * password: the code lives ten minutes, the search space is exhausted by the
   * attempt cap rather than by cracking, and a per-row salt would buy nothing
   * against an attacker who already has the row. What matters is that the
   * table never contains a code somebody could read and use.
   */
  private hash(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  /** Cryptographically random, not `Math.random`. This is a credential. */
  private generate(): string {
    const max = 10 ** OTP_LENGTH;
    return String(randomInt(0, max)).padStart(OTP_LENGTH, '0');
  }

  /**
   * Issue a code and send it.
   *
   * Returns a challenge even when nothing was sent — a cap hit, or no provider
   * configured. The caller has already saved the lead by this point, so there
   * is nothing to roll back and nothing to apologise for; the page simply says
   * verification is unavailable.
   */
  async issue(input: {
    mobile: string;
    purpose: OtpPurpose;
    leadId: string | null;
    ipAddress: string | null;
  }): Promise<OtpChallenge> {
    const unavailable: OtpChallenge = {
      verificationId: null,
      expiresInSeconds: 0,
      maskedMobile: maskMobile(input.mobile),
      sent: false,
    };

    /*
      How many codes this number has been sent in the last hour.

      Counted per number rather than per IP as the primary control, because the
      cost and the nuisance both land on the person holding that phone. An IP
      limit sits in front of this at the controller and catches the other shape
      of abuse — one address working through a list.
    */
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await this.prisma.mobileOtp.count({
      where: { mobile: input.mobile, createdAt: { gte: since } },
    });
    if (recent >= OTP_MAX_SENDS_PER_HOUR) {
      this.logger.warn(
        `OTP cap reached for ${maskMobile(input.mobile)} — ${recent} in the last hour`,
      );
      return unavailable;
    }

    const code = this.generate();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    /*
      Any code still outstanding for this number is retired first.

      Without this, an earlier code stays valid alongside the new one, so a
      resend widens the window instead of replacing it — and somebody reading
      the older message would be told, correctly but confusingly, that their
      code is wrong.
    */
    await this.prisma.mobileOtp.updateMany({
      where: { mobile: input.mobile, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });

    const record = await this.prisma.mobileOtp.create({
      data: {
        mobile: input.mobile,
        purpose: input.purpose,
        codeHash: this.hash(code),
        leadId: input.leadId,
        expiresAt,
        ipAddress: input.ipAddress,
      },
      select: { id: true },
    });

    const result = await this.sms.send({
      mobile: input.mobile,
      body: renderOtpMessage(code),
      templateId: this.config.sms.otpTemplateId,
    });

    /*
      Record what the provider said, on the row.

      Without this, "did the message go?" can only be answered by querying the
      provider from a production shell — which is how the first missing code was
      eventually explained, long after the person had given up waiting.
    */
    await this.prisma.mobileOtp.update({
      where: { id: record.id },
      data: {
        sent: result.accepted,
        providerResponse: (result.accepted
          ? result.providerMessageId
          : result.failureReason
        )?.slice(0, 200),
      },
    });

    if (!result.accepted) {
      // The row stays. The person may still receive a delayed message, and the
      // attempt is evidence when somebody reports that nothing arrived.
      this.logger.warn(
        `OTP send refused for ${maskMobile(input.mobile)}: ${result.failureReason ?? 'unknown'}`,
      );
      return { ...unavailable, verificationId: record.id };
    }

    return {
      verificationId: record.id,
      expiresInSeconds: OTP_TTL_MINUTES * 60,
      maskedMobile: maskMobile(input.mobile),
      sent: true,
    };
  }

  /**
   * Check a code and, if it is right, stamp the lead as verified.
   *
   * Every failure path returns the same shape rather than throwing, because the
   * caller is a public endpoint and the difference between "no such
   * verification", "expired" and "wrong" is exactly what an attacker probes
   * for. The reasons given back are deliberately about what the person should
   * do next, not about which check failed.
   */
  async verify(verificationId: string, code: string): Promise<OtpVerifyResult> {
    const record = await this.prisma.mobileOtp.findUnique({
      where: { id: verificationId },
      select: {
        id: true,
        mobile: true,
        codeHash: true,
        leadId: true,
        expiresAt: true,
        attempts: true,
        consumedAt: true,
      },
    });

    const generic: OtpVerifyResult = {
      verified: false,
      reason: 'That code is not valid. Ask for a new one.',
      attemptsRemaining: 0,
    };

    if (!record || record.consumedAt) return generic;
    if (record.expiresAt <= new Date()) {
      return { ...generic, reason: 'That code has expired. Ask for a new one.' };
    }
    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      await this.prisma.mobileOtp.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      });
      return { ...generic, reason: 'Too many wrong attempts. Ask for a new code.' };
    }

    /*
      Constant-time comparison.

      Both sides are fixed-length hex digests, so the lengths always match and
      the comparison cannot leak through an early exit. Overkill for six digits
      behind an attempt cap, but the alternative is a habit of comparing secrets
      with `===`.
    */
    const supplied = Buffer.from(this.hash(code), 'hex');
    const stored = Buffer.from(record.codeHash, 'hex');
    const matches = supplied.length === stored.length && timingSafeEqual(supplied, stored);

    if (!matches) {
      const updated = await this.prisma.mobileOtp.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
        select: { attempts: true },
      });
      const remaining = Math.max(0, OTP_MAX_ATTEMPTS - updated.attempts);
      return {
        verified: false,
        reason:
          remaining > 0
            ? 'That code is not right. Try again.'
            : 'Too many wrong attempts. Ask for a new code.',
        attemptsRemaining: remaining,
      };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.mobileOtp.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      });

      if (record.leadId) {
        await tx.lead.update({
          where: { id: record.leadId },
          data: {
            mobileVerifiedAt: new Date(),
            // 'OTP', matching the manual methods the verify-mobile endpoint
            // already records, so one column answers "how was this proven".
            mobileVerificationMethod: 'OTP',
            mobileVerificationNote: 'Verified by SMS code at event registration',
            // Deliberately no verifier: nobody on staff vouched for this, the
            // holder of the handset did. Leaving it null is what distinguishes
            // a proven number from one a rep asserted.
          },
        });
      }
    });

    // The one message a visitor gets after confirming: where to find the
    // schedule and our literature. Never allowed to fail the verification.
    if (record.leadId) await this.sendEventRegistrationSms(record.leadId, record.mobile);

    /*
      The pass to book a seat, minted here because this is the moment the
      number became proven. The acknowledgement screen shows its booking button
      on the strength of this and nothing else.
    */
    const bookingToken = record.leadId
      ? await this.presentations.bookingTokenFor(record.leadId)
      : null;

    return { verified: true, reason: null, attemptsRemaining: OTP_MAX_ATTEMPTS, bookingToken };
  }

  /**
   * "Thank you for registering… event schedule and details: <link>".
   *
   * Sent once, the moment a number is confirmed, because that is when the
   * visitor is holding the phone and has just proved it reaches them.
   *
   * Which event is resolved from the attendance row this registration wrote,
   * not from `lead.eventId`. For a returning visitor those disagree — the lead
   * still points at the event that first produced them — and naming the wrong
   * event in a message to a client is worse than sending nothing.
   *
   * Every failure is swallowed. The number is already verified and the lead is
   * already on the book; losing either because a gateway was slow would be a
   * poor trade for a courtesy message.
   *
   * Public because it is called from two places. Confirming a code is the
   * usual one; the other is a returning visitor who is sent no code at all,
   * and who would otherwise never be told where the schedule is.
   */
  async sendEventRegistrationSms(leadId: string, mobile: string): Promise<void> {
    try {
      const attendance = await this.prisma.eventAttendance.findFirst({
        where: { leadId },
        orderBy: { createdAt: 'desc' },
        select: { event: { select: { name: true } } },
      });
      const eventName = attendance?.event?.name;
      // No event means this was not an event registration — a website enquiry
      // has nothing to be told about a schedule.
      if (!eventName) return;

      const sms = this.config.sms;
      const result = await this.sms.send({
        mobile,
        body: renderEventRegistrationMessage(eventName, sms.eventLink),
        templateId: sms.eventTemplateId,
        route: sms.eventRoute,
      });

      /*
        Logged either way, on purpose.

        The OTP send records `sent` and `providerResponse` on its own row, so a
        failure can be read back afterwards. This message has no such row, and
        the adapter only speaks up when it fails — so a message the gateway
        accepted and never delivered left no trace at all, and "the SMS did not
        arrive" could not be told apart from "it was never attempted".

        The gateway's own id is the useful part: it is what onlysms can be
        asked about when a message is accepted and still does not land.
      */
      if (result.accepted) {
        this.logger.log(
          `Event SMS accepted for ${maskMobile(mobile)} ` +
            `[route=${sms.eventRoute} template=${sms.eventTemplateId}] ` +
            `id=${result.providerMessageId ?? 'none'}`,
        );
      } else {
        this.logger.warn(
          `Event SMS refused for ${maskMobile(mobile)} ` +
            `[route=${sms.eventRoute} template=${sms.eventTemplateId}]: ` +
            `${result.failureReason ?? 'no reason given'}`,
        );
      }
    } catch (error) {
      this.logger.warn(`Event SMS not sent: ${String(error)}`);
    }
  }

  /** Whether a provider is wired up, so callers can avoid promising an SMS. */
  get available(): boolean {
    return this.sms.configured;
  }
}
