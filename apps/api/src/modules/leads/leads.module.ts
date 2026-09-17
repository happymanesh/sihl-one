import { Module } from '@nestjs/common';

import { VisitsModule } from '../visits/visits.module';
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
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
