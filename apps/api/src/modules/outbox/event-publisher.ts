import { Injectable, Logger } from '@nestjs/common';

export interface OutboundEvent {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  occurredAt: Date;
}

/**
 * Where integration events go once they leave SIHL ONE.
 *
 * The relay owns delivery *semantics* — claiming, backoff, dead-lettering —
 * and this owns the *transport*. Swapping Kafka for Azure Service Bus, or
 * pointing at a webhook while an integration is being built, is a change to one
 * class with no effect on ordering, retries or the audit story.
 */
export interface EventPublisher {
  readonly name: string;
  publish(event: OutboundEvent): Promise<void>;
}

export const EVENT_PUBLISHER = 'EVENT_PUBLISHER';

/**
 * Default publisher: writes the event to the application log.
 *
 * Deliberately not a silent no-op. Until a real bus is wired, an operator can
 * still see that `lead.converted` fired for a specific reference at a specific
 * time, which is what makes the first real integration debuggable on day one.
 */
@Injectable()
export class LoggingEventPublisher implements EventPublisher {
  readonly name = 'logging';
  private readonly logger = new Logger('OutboxEvent');

  async publish(event: OutboundEvent): Promise<void> {
    this.logger.log(
      `${event.eventType} ${event.aggregateType}:${event.aggregateId} ` +
        `${JSON.stringify(event.payload)}`,
    );
  }
}
