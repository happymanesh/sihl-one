import { Module } from '@nestjs/common';

import { MessageSender, RecordingMessageSender } from './message-sender';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';

/**
 * Swapping in a real provider is one line here: bind `MessageSender` to a
 * SendGrid, MSG91 or WhatsApp adapter. Nothing else in the application changes,
 * because the consent gate sits above this and not inside it.
 */
@Module({
  controllers: [MessagingController],
  providers: [MessagingService, { provide: MessageSender, useClass: RecordingMessageSender }],
  exports: [MessagingService],
})
export class MessagingModule {}
