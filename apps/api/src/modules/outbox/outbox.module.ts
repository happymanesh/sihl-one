import { Module } from '@nestjs/common';

import {
  CompositeEventPublisher,
  NotificationPublisher,
} from '../notifications/notification.publisher';
import { NotificationsModule } from '../notifications/notifications.module';
import { EVENT_PUBLISHER, LoggingEventPublisher } from './event-publisher';
import { OutboxRelayService } from './outbox-relay.service';
import { OutboxController } from './outbox.controller';

@Module({
  imports: [NotificationsModule],
  controllers: [OutboxController],
  providers: [
    LoggingEventPublisher,
    {
      // Both, not one. Replacing the logging publisher would have silenced the
      // event log, which is currently the only way an operator can see that
      // `lead.converted` fired for a given reference — the reason that
      // publisher was written not to be a silent no-op in the first place.
      provide: EVENT_PUBLISHER,
      useFactory: (logging: LoggingEventPublisher, notifications: NotificationPublisher) =>
        new CompositeEventPublisher([logging, notifications]),
      inject: [LoggingEventPublisher, NotificationPublisher],
    },
    OutboxRelayService,
  ],
  exports: [OutboxRelayService],
})
export class OutboxModule {}
