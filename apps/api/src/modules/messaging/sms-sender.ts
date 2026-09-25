import { Injectable, Logger } from '@nestjs/common';
import { maskMobile } from '@sihl-one/contracts';

export interface SmsRequest {
  /** Ten digits, no country code — normalised at the edge. */
  mobile: string;
  body: string;
  /** DLT content template id. The operator rejects a mismatch. */
  templateId: string;
  /**
   * Which of the provider's endpoints to use.
   *
   * Not cosmetic. An OTP-category template sent down the transactional route
   * is accepted by the gateway and then dropped by the operator — the gateway
   * answers 100 either way, so the only evidence is that no phone rings. The
   * category the template was registered under decides this, not the content.
   */
  route?: 'otp' | 'text';
}

export interface SmsResult {
  accepted: boolean;
  providerMessageId: string | null;
  failureReason: string | null;
}

/**
 * The seam a real SMS provider plugs into.
 *
 * Mirrors `MessageSender` deliberately: hand it a rendered message, get back
 * whether the provider took it. Nothing here decides *whether* a message may be
 * sent — the rate limits, the attempt caps and the consent questions all happen
 * before this, so a provider adapter can never quietly become the place those
 * live.
 */
export abstract class SmsSender {
  abstract send(request: SmsRequest): Promise<SmsResult>;
  /** False when no provider is configured, so callers can say so honestly. */
  abstract get configured(): boolean;
}

/**
 * Logs the message and sends nothing.
 *
 * The default. With no credentials set this keeps the whole flow real and
 * testable — code generated, stored hashed, verified, lead stamped — while
 * costing nothing and troubling nobody's phone.
 *
 * The code is logged on purpose, and only ever by this class. It is what makes
 * the flow exercisable end to end in development; a provider-backed build never
 * reaches this line.
 */
@Injectable()
export class RecordingSmsSender extends SmsSender {
  private readonly logger = new Logger('SmsSender');

  get configured(): boolean {
    return false;
  }

  send(request: SmsRequest): Promise<SmsResult> {
    this.logger.log(
      `[not sent — no SMS provider configured] to ${maskMobile(request.mobile)}: ${request.body}`,
    );
    return Promise.resolve({
      accepted: true,
      providerMessageId: `recorded:${Date.now()}`,
      failureReason: null,
    });
  }
}
