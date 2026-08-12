import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { EVENT_PUBLISHER, type EventPublisher, type OutboundEvent } from './event-publisher';

interface ClaimedRow {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  occurredAt: Date;
  attempts: number;
}

/**
 * Relays transactional-outbox rows to the event bus.
 *
 * Delivery is **at-least-once**. Events are marked published only after the
 * publisher returns, so a crash between publish and commit replays the event.
 * Consumers must therefore be idempotent — exactly-once across a network is not
 * available at any price, and pretending otherwise just moves the bug.
 *
 * Ordering is per-aggregate by `occurredAt`, not global. Global ordering would
 * require a single-threaded relay and would make one slow consumer everyone
 * else's problem.
 */
@Injectable()
export class OutboxRelayService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;

  private publishedCount = 0;
  private failedCount = 0;
  private deadLetteredCount = 0;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(EVENT_PUBLISHER) private readonly publisher: EventPublisher,
    private readonly prisma: PrismaService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.outbox.enabled) {
      this.logger.warn('Outbox relay is disabled. Integration events will accumulate unsent.');
      return;
    }

    this.logger.log(
      `Outbox relay started — every ${this.config.outbox.intervalMs} ms, ` +
        `batch ${this.config.outbox.batchSize}, publisher "${this.publisher.name}"`,
    );

    // setInterval rather than a cron library: the relay is a tight polling loop
    // with its own re-entrancy guard, and a scheduler dependency would add
    // configuration surface without changing behaviour.
    this.timer = setInterval(() => void this.tick(), this.config.outbox.intervalMs);
    // Do not hold the process open on this timer alone.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  /** Counts for the health endpoint and, later, for Prometheus. */
  async stats() {
    const [pending, deadLettered, oldestPending] = await this.prisma.$transaction([
      this.prisma.outboxEvent.count({ where: { publishedAt: null, deadLetteredAt: null } }),
      this.prisma.outboxEvent.count({ where: { deadLetteredAt: { not: null } } }),
      this.prisma.outboxEvent.findFirst({
        where: { publishedAt: null, deadLetteredAt: null },
        orderBy: { occurredAt: 'asc' },
        select: { occurredAt: true },
      }),
    ]);

    return {
      enabled: this.config.outbox.enabled,
      publisher: this.publisher.name,
      pending,
      deadLettered,
      oldestPendingAt: oldestPending?.occurredAt.toISOString() ?? null,
      publishedSinceBoot: this.publishedCount,
      failedSinceBoot: this.failedCount,
      deadLetteredSinceBoot: this.deadLetteredCount,
    };
  }

  /**
   * One relay pass.
   *
   * Public so tests can drive it deterministically rather than waiting on a
   * timer, and so an operator can trigger a flush.
   */
  async tick(): Promise<number> {
    // Re-entrancy guard: a batch slower than the interval must not overlap with
    // itself, or the same rows get claimed twice within one process.
    if (this.running || this.stopped) return 0;
    this.running = true;

    try {
      const claimed = await this.claim();
      if (claimed.length === 0) return 0;

      for (const event of claimed) {
        await this.deliver(event);
      }
      return claimed.length;
    } catch (error) {
      this.logger.error(
        'Outbox relay pass failed',
        error instanceof Error ? error.stack : String(error),
      );
      return 0;
    } finally {
      this.running = false;
    }
  }

  /**
   * Claims a batch with `FOR UPDATE SKIP LOCKED`.
   *
   * This is what makes the relay safe to run on every API pod: concurrent
   * claimers step over each other's locked rows instead of blocking or, worse,
   * both publishing the same event. `attempts` is incremented at claim time, so
   * a process that dies mid-publish still burns an attempt and the row is
   * eventually dead-lettered rather than retried forever.
   */
  private async claim(): Promise<ClaimedRow[]> {
    return this.prisma.$queryRaw<ClaimedRow[]>`
      WITH claimed AS (
        SELECT "id"
        FROM "outbox_event"
        WHERE "publishedAt" IS NULL
          AND "deadLetteredAt" IS NULL
          AND "nextAttemptAt" <= NOW()
        ORDER BY "occurredAt" ASC
        LIMIT ${this.config.outbox.batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "outbox_event" AS e
      SET "attempts" = e."attempts" + 1
      FROM claimed
      WHERE e."id" = claimed."id"
      RETURNING e."id", e."aggregateType", e."aggregateId", e."eventType",
                e."payload", e."occurredAt", e."attempts"
    `;
  }

  private async deliver(row: ClaimedRow): Promise<void> {
    const event: OutboundEvent = {
      id: row.id,
      aggregateType: row.aggregateType,
      aggregateId: row.aggregateId,
      eventType: row.eventType,
      payload: row.payload,
      occurredAt: row.occurredAt,
    };

    try {
      await this.publisher.publish(event);
      await this.prisma.outboxEvent.update({
        where: { id: row.id },
        data: { publishedAt: new Date(), lastError: null },
      });
      this.publishedCount += 1;
    } catch (error) {
      this.failedCount += 1;
      const message = error instanceof Error ? error.message : String(error);

      if (row.attempts >= this.config.outbox.maxAttempts) {
        // Dead-letter rather than retry forever. The row is kept — it is the
        // evidence for whatever went wrong — and an alert on this count is what
        // turns a silent integration failure into a page.
        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: { deadLetteredAt: new Date(), lastError: message.slice(0, 500) },
        });
        this.deadLetteredCount += 1;
        this.logger.error(
          `Dead-lettered ${row.eventType} (${row.id}) after ${row.attempts} attempts: ${message}`,
        );
        return;
      }

      // Exponential backoff with a ceiling, so a consumer that is down for an
      // hour is retried a handful of times rather than thousands.
      const delaySeconds = Math.min(2 ** row.attempts, 900);
      await this.prisma.outboxEvent.update({
        where: { id: row.id },
        data: {
          nextAttemptAt: new Date(Date.now() + delaySeconds * 1000),
          lastError: message.slice(0, 500),
        },
      });
      this.logger.warn(
        `Publish failed for ${row.eventType} (${row.id}), attempt ${row.attempts}; ` +
          `retrying in ${delaySeconds}s: ${message}`,
      );
    }
  }
}
