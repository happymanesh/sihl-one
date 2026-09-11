import { Inject, Injectable, Logger } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../../config/configuration';
import { passwordResetEmail } from './password-reset.template';

/**
 * System email.
 *
 * Deliberately *not* wired to the `MessageSender` seam in the messaging module.
 * That seam serves campaigns and client messaging, and binding it to a live
 * provider would quietly turn on real sending for every template in the system
 * — a much larger change than "tell a member of staff their password was
 * reset". Two seams, two blast radii.
 *
 * It is also why nothing here writes to `MessageLog`: that table stores the
 * rendered body, and the body of this email contains a temporary password. The
 * one thing `issueCredentials` is careful never to persist should not be
 * persisted by the email that carries it.
 */

export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailResult {
  accepted: boolean;
  providerMessageId: string | null;
  failureReason: string | null;
}

export abstract class Mailer {
  abstract send(email: OutboundEmail): Promise<EmailResult>;

  /**
   * The one message this system sends today.
   *
   * Takes the temporary password as an argument and hands it straight to the
   * template. It is never stored, never logged, and never placed on an object
   * that outlives the call.
   */
  async sendPasswordReset(input: {
    to: string;
    firstName: string;
    employeeCode: string | null;
    temporaryPassword: string;
    appUrl: string;
    productName: string;
  }): Promise<EmailResult> {
    const rendered = passwordResetEmail({
      firstName: input.firstName,
      employeeCode: input.employeeCode,
      email: input.to,
      temporaryPassword: input.temporaryPassword,
      appUrl: input.appUrl,
      when: new Date(),
      productName: input.productName,
    });
    return this.send({ to: input.to, ...rendered });
  }
}

/** Masked for logs: enough to identify a recipient, not enough to be a mailing list. */
export function maskEmail(address: string): string {
  const [local = '', domain = ''] = address.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}

/**
 * The default. Logs that an email would have gone out and sends nothing.
 *
 * This is what runs in development, in CI and anywhere `MAIL_DRIVER` is unset,
 * so no test run and no local experiment can mail a real member of staff. The
 * subject is logged; the body never is, because it contains the password.
 */
@Injectable()
export class NoopMailer extends Mailer {
  private readonly logger = new Logger('Mailer');

  send(email: OutboundEmail): Promise<EmailResult> {
    this.logger.log(
      `[not sent — MAIL_DRIVER=noop] to ${maskEmail(email.to)}: ${email.subject}`,
    );
    // Reports failure, not success. Claiming an email was accepted when none
    // left the building would tell an administrator "Emailed to the user" while
    // the person waits for something that is never coming — and if a deploy
    // ever went out with MAIL_DRIVER unset, that lie would be the only symptom.
    // Saying so plainly makes the admin pass the password on by hand, which is
    // exactly the right behaviour when there is no mailer.
    return Promise.resolve({
      accepted: false,
      providerMessageId: null,
      failureReason: 'No mailer configured (MAIL_DRIVER=noop)',
    });
  }
}

/**
 * SendGrid, over its v3 REST API.
 *
 * Plain `fetch` rather than `@sendgrid/mail`. The SDK is a thin wrapper over
 * this one request, and the project already carries ten advisories in its
 * production dependency tree — one of them arriving with the last package
 * added. A dependency that buys a JSON body and a bearer header is not worth
 * the supply-chain surface in a system holding client data.
 */
@Injectable()
export class SendGridMailer extends Mailer {
  private readonly logger = new Logger('Mailer');
  private readonly endpoint = 'https://api.sendgrid.com/v3/mail/send';

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
  }

  async send(email: OutboundEmail): Promise<EmailResult> {
    const { apiKey, from, fromName } = this.config.mail;
    if (!apiKey || !from) {
      // Boot validation should have caught this; the guard is here because a
      // silent no-send is worse than a loud failure.
      return { accepted: false, providerMessageId: null, failureReason: 'Mailer not configured' };
    }

    // A hung provider must not hold a request thread open indefinitely. The
    // caller treats a failure as non-fatal, so timing out is safe.
    const abort = AbortSignal.timeout(15_000);

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: email.to }] }],
          from: { email: from, name: fromName },
          reply_to: { email: from },
          subject: email.subject,
          content: [
            // Order matters to the RFC: the richest part goes last, so a client
            // that understands HTML picks it over the plain-text fallback.
            { type: 'text/plain', value: email.text },
            { type: 'text/html', value: email.html },
          ],
        }),
        signal: abort,
      });

      if (!response.ok) {
        // SendGrid replies with a JSON errors array; take the first message and
        // leave the rest, since this string ends up in a log line.
        const detail = await response.text().catch(() => '');
        const reason = firstError(detail) ?? `HTTP ${response.status}`;
        this.logger.error(`Email to ${maskEmail(email.to)} refused by SendGrid: ${reason}`);
        return { accepted: false, providerMessageId: null, failureReason: reason };
      }

      const id = response.headers.get('x-message-id');
      this.logger.log(`Email accepted for ${maskEmail(email.to)} (${id ?? 'no id'})`);
      return { accepted: true, providerMessageId: id, failureReason: null };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Email to ${maskEmail(email.to)} failed: ${reason}`);
      return { accepted: false, providerMessageId: null, failureReason: reason };
    }
  }
}

function firstError(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'errors' in parsed &&
      Array.isArray((parsed as { errors: unknown[] }).errors)
    ) {
      const first = (parsed as { errors: Array<{ message?: string }> }).errors[0];
      return first?.message ?? null;
    }
  } catch {
    // Not JSON. The status code is a better answer than a wall of HTML.
  }
  return null;
}
