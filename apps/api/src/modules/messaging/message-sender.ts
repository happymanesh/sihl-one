import { Injectable, Logger } from '@nestjs/common';
import type { MessageChannel } from '@sihl-one/contracts';

export interface OutboundMessage {
  channel: MessageChannel;
  destination: string;
  subject: string | null;
  body: string;
  /** Meta's approved-template id, for business-initiated WhatsApp. */
  providerTemplateId: string | null;
}

export interface SendResult {
  accepted: boolean;
  /** The provider's id, for reconciling a later delivery receipt. */
  providerMessageId: string | null;
  failureReason: string | null;
}

/**
 * The seam a real provider plugs into.
 *
 * Deliberately narrow: hand it a rendered message, get back whether the
 * provider accepted it. Everything that decides *whether* a message may be sent
 * happens before this — see `canSend` in the contracts — so a provider
 * integration can never accidentally become the place consent is checked.
 */
export abstract class MessageSender {
  abstract send(message: OutboundMessage): Promise<SendResult>;
}

/**
 * Records the message and sends nothing.
 *
 * The default, and the only implementation today. SIHL has no provider
 * credentials yet, and a half-wired SendGrid or MSG91 adapter that nobody can
 * exercise is worse than an honest stub: it looks finished, and the first time
 * anyone finds out it is not is when a client does not receive something.
 *
 * With this in place the whole pipeline is real and testable — template,
 * consent gate, rendering, logging, delivery status — and swapping in a
 * provider is one class and a credential, with the compliance logic already
 * proven.
 */
@Injectable()
export class RecordingMessageSender extends MessageSender {
  private readonly logger = new Logger('MessageSender');

  send(message: OutboundMessage): Promise<SendResult> {
    this.logger.log(
      `[not sent — no provider configured] ${message.channel} to ${mask(message.destination)}: ` +
        `${message.subject ? `${message.subject} — ` : ''}${message.body.slice(0, 80)}`,
    );

    return Promise.resolve({
      accepted: true,
      // Prefixed so nothing downstream mistakes a recorded message for one a
      // provider actually acknowledged.
      providerMessageId: `recorded:${Date.now()}`,
      failureReason: null,
    });
  }
}

function mask(destination: string): string {
  if (destination.includes('@')) {
    const [local = '', domain = ''] = destination.split('@');
    return `${local.slice(0, 2)}***@${domain}`;
  }
  return `••••••${destination.slice(-4)}`;
}
