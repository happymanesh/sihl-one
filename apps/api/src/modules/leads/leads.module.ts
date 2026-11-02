import { Module } from '@nestjs/common';

import { VisitsModule } from '../visits/visits.module';
import { APP_CONFIG, type AppConfig } from '../../config/configuration';
import { OnlySmsSender } from '../messaging/onlysms-sender';
import { RecordingSmsSender, SmsSender } from '../messaging/sms-sender';
import { ExistingClientService } from './existing-client.service';
import { LeadPurgeService } from './lead-purge.service';
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
    ExistingClientService,
    /*
      The hard delete, kept in its own provider rather than folded into
      LeadsService. Nothing else in this module can undo what it does, and a
      separate class is the cheapest way to make sure a change to the ordinary
      soft delete never lands on it by accident. StorageService arrives from
      the global StorageModule.
    */
    LeadPurgeService,
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
