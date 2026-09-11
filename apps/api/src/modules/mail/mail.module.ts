import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../../config/configuration';
import { Mailer, NoopMailer, SendGridMailer } from './mailer';

/**
 * Global, because a password reset is issued from the users module and future
 * system email will come from elsewhere again — and there is only ever one
 * mailer.
 *
 * The driver is chosen once, at boot, from configuration. Anything other than
 * an explicit `MAIL_DRIVER=sendgrid` gets the no-op, so the safe default is the
 * one you fall into by forgetting.
 */
@Global()
@Module({
  providers: [
    {
      provide: Mailer,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.mail.driver === 'sendgrid' ? new SendGridMailer(config) : new NoopMailer(),
    },
  ],
  exports: [Mailer],
})
export class MailModule {}
