import { Global, Module } from '@nestjs/common';

import { CaptureCodeService } from './capture-code.service';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

/** Global: public lead capture resolves its codes through this module. */
@Global()
@Module({
  controllers: [EventsController],
  providers: [EventsService, CaptureCodeService],
  exports: [EventsService, CaptureCodeService],
})
export class EventsModule {}
