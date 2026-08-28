import { Injectable, Logger } from '@nestjs/common';
import { notificationsFor, type RoutableEvent } from '@sihl-one/contracts';

import { PrismaService } from '../../prisma/prisma.service';
import type { EventPublisher, OutboundEvent } from '../outbox/event-publisher';

/**
 * Turns outbox events into notifications.
 *
 * This is a *consumer* of the outbox rather than a write in each service's
 * transaction, for two reasons. The outbox already owns delivery semantics —
 * claiming, backoff, dead-lettering — so a database hiccup here retries for
 * free. And the decision about who needs telling stays in one place instead of
 * leaking into every service that happens to emit an event.
 *
 * The cost is that a notification lands up to one relay tick (5s) after the
 * action, which nobody will notice, and which is the right trade against
 * putting extra writes in the request path.
 */
@Injectable()
export class NotificationPublisher implements EventPublisher {
  readonly name = 'notifications';
  private readonly logger = new Logger('Notifications');

  constructor(private readonly prisma: PrismaService) {}

  async publish(event: OutboundEvent): Promise<void> {
    const actorId =
      event.payload !== null && typeof event.payload === 'object'
        ? ((event.payload as Record<string, unknown>).actorId as string | undefined)
        : undefined;

    const routable: RoutableEvent = {
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: event.payload,
      actorId: actorId ?? null,
    };

    const planned = notificationsFor(routable);
    if (planned.length === 0) return;

    // skipDuplicates leans on the unique index over
    // (userId, sourceEventId, type). A relay retry after a partial failure
    // re-runs this with the same event id and writes nothing the second time,
    // so eight attempts cannot produce eight bells.
    const { count } = await this.prisma.notification.createMany({
      data: planned.map((n) => ({
        userId: n.userId,
        type: n.type,
        title: n.title,
        body: n.body ?? null,
        entityType: n.entityType ?? null,
        entityId: n.entityId ?? null,
        actorId: actorId ?? null,
        sourceEventId: event.id,
      })),
      skipDuplicates: true,
    });

    if (count > 0) {
      this.logger.log(`${event.eventType} → ${count} notification(s)`);
    }
  }
}

/**
 * Fans one event out to several publishers.
 *
 * Wiring notifications by replacing the logging publisher would have silenced
 * the event log, which is the only way an operator can currently see that
 * `lead.converted` fired for a given reference. Both run; the relay sees one
 * publisher and its retry semantics are unchanged.
 *
 * Failures are deliberately not swallowed. If notifications cannot be written
 * the event is retried, and a redelivery is harmless because the write is
 * idempotent — that is the whole reason it was made idempotent.
 */
@Injectable()
export class CompositeEventPublisher implements EventPublisher {
  readonly name: string;

  constructor(private readonly publishers: EventPublisher[]) {
    this.name = publishers.map((p) => p.name).join('+');
  }

  async publish(event: OutboundEvent): Promise<void> {
    for (const publisher of this.publishers) {
      await publisher.publish(event);
    }
  }
}
