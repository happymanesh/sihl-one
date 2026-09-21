import { Inject, Injectable, Logger } from '@nestjs/common';
import { maskMobile } from '@sihl-one/contracts';

import { APP_CONFIG, type AppConfig } from '../../config/configuration';
import { SmsSender, type SmsRequest, type SmsResult } from './sms-sender';

/**
 * onlysms.co.in.
 *
 * Every parameter, credentials included, goes in the query string — that is the
 * provider's design, not a choice made here. Two consequences are handled
 * deliberately:
 *
 *   - **The URL is never logged.** It carries `UserPass` in clear, so a log
 *     line, an error message or an audit row containing it would leak the
 *     account password to anyone who can read logs. Failures report the status
 *     code and the masked number, never the request.
 *   - **The request is POSTed with an empty body.** The provider reads the
 *     query string either way; POST keeps the URL out of any intermediary's
 *     request line where GET would put it in every access log between here and
 *     them.
 *
 * `TEMPID` must match the text character for character. The text comes from
 * `renderOtpMessage` in the contracts, which exists so the approved wording
 * lives in exactly one place.
 */
@Injectable()
export class OnlySmsSender extends SmsSender {
  private readonly logger = new Logger('SmsSender');

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
  }

  get configured(): boolean {
    return true;
  }

  async send(request: SmsRequest): Promise<SmsResult> {
    const sms = this.config.sms;
    const url = new URL(sms.textUrl);
    url.searchParams.set('UserID', sms.userId);
    url.searchParams.set('UserPass', sms.password);
    url.searchParams.set('MobileNo', request.mobile);
    url.searchParams.set('GSMID', sms.senderId);
    url.searchParams.set('PEID', sms.peId);
    url.searchParams.set('Message', request.body);
    url.searchParams.set('TEMPID', request.templateId);
    url.searchParams.set('UNICODE', 'TEXT');

    try {
      /*
        A timeout, because a hanging provider must not hold a person at a stall
        staring at a spinner. Ten seconds is long for an SMS gateway and short
        enough that the page can move on and offer a resend.
      */
      const response = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(10_000),
      });

      const text = (await response.text().catch(() => '')).trim();

      if (!response.ok) {
        // Status and body only. Never the URL.
        this.logger.warn(
          `SMS rejected for ${maskMobile(request.mobile)}: HTTP ${response.status} ${text.slice(0, 120)}`,
        );
        return {
          accepted: false,
          providerMessageId: null,
          failureReason: `Provider returned HTTP ${response.status}`,
        };
      }

      /*
        The gateway answers 200 with a body that says what happened, so a 200 is
        not on its own a send. Anything that looks like a refusal is treated as
        one — better a resend offered than a person waiting for a message that
        was never accepted.
      */
      const refused = /error|invalid|fail|denied|insufficient|blocked/i.test(text);
      if (refused) {
        this.logger.warn(`SMS refused for ${maskMobile(request.mobile)}: ${text.slice(0, 160)}`);
        return {
          accepted: false,
          providerMessageId: null,
          failureReason: text.slice(0, 200) || 'Provider refused the message',
        };
      }

      return {
        accepted: true,
        providerMessageId: text.slice(0, 120) || null,
        failureReason: null,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown transport error';
      this.logger.error(`SMS failed for ${maskMobile(request.mobile)}: ${reason}`);
      return { accepted: false, providerMessageId: null, failureReason: reason };
    }
  }
}
