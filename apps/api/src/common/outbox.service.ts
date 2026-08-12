import { Injectable } from '@nestjs/common';

import type { PrismaService } from '../prisma/prisma.service';

/** Minimal surface both PrismaService and a transaction client satisfy. */
type TransactionalClient = Pick<PrismaService, 'outboxEvent'>;

export interface DomainEvent {
  aggregateType: 'lead' | 'customer' | 'partner' | 'task' | 'visit' | 'campaign' | 'event' | 'user';
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

/**
 * Transactional outbox.
 *
 * Integration events are inserted inside the same transaction as the state
 * change that produced them. A relay worker then publishes unpublished rows to
 * the event bus and stamps `publishedAt`.
 *
 * The alternative — publishing directly from the service after the commit —
 * has a window between commit and publish in which a crash loses the event
 * permanently. In this system that means a converted lead whose eKYC is never
 * triggered, or a visit that never reaches the incentive engine. Both are the
 * kind of failure nobody notices for a month.
 *
 * Consumers must be idempotent: the relay guarantees at-least-once delivery,
 * not exactly-once. Exactly-once across a network is not available at any price.
 */
@Injectable()
export class OutboxService {
  async publish(client: TransactionalClient, event: DomainEvent): Promise<void> {
    await client.outboxEvent.create({
      data: {
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payload: event.payload as never,
      },
    });
  }

  async publishMany(client: TransactionalClient, events: DomainEvent[]): Promise<void> {
    if (events.length === 0) return;
    await client.outboxEvent.createMany({
      data: events.map((event) => ({
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payload: event.payload as never,
      })),
    });
  }
}
