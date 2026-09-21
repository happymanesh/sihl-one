import { Module } from '@nestjs/common';

import { VisitsModule } from '../visits/visits.module';
import { APP_CONFIG, type AppConfig } from '../../config/configuration';
import { OnlySmsSender } from '../messaging/onlysms-sender';
import { RecordingSmsSender, SmsSender } from '../messaging/sms-sender';
import { OtpService } from './otp.service';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

/**
 * Imports VisitsModule for one reason: Insta Lead.
 *
 * Capturing somebody standing in front of you creates a lead *and* the meeting
 * in one action, so the orchestration has to reach both. It reuses
 * `VisitsService.plan` and `checkIn` rather than writing visit rows directly —
 * the photo rule, the attendee handling and the evidence checks all live there
 * and must not grow a second implementation that drifts.
 */
@Module({
  imports: [VisitsModule],
  controllers: [LeadsController],
  providers: [
    LeadsService,
    OtpService,
    /*
      The SMS driver is chosen here, once, from configuration — the same shape
      as MessagingModule binds MessageSender. `noop` is the default, so a build
      with no credentials logs the code and texts nobody.
    */
    {
      provide: SmsSender,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): SmsSender =>
        config.sms.driver === 'onlysms'
          ? new OnlySmsSender(config)
          : new RecordingSmsSender(),
    },
  ],
  exports: [LeadsService],
})
export class LeadsModule {}
