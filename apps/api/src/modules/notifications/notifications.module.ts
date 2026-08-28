import { Module } from '@nestjs/common';

import { NotificationPublisher } from './notification.publisher';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationPublisher],
  exports: [NotificationsService, NotificationPublisher],
})
export class NotificationsModule {}
