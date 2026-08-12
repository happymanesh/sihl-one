import { Module } from '@nestjs/common';

import { EVENT_PUBLISHER, LoggingEventPublisher } from './event-publisher';
import { OutboxRelayService } from './outbox-relay.service';
import { OutboxController } from './outbox.controller';

@Module({
  controllers: [OutboxController],
  providers: [
    { provide: EVENT_PUBLISHER, useClass: LoggingEventPublisher },
    OutboxRelayService,
  ],
  exports: [OutboxRelayService],
})
export class OutboxModule {}
