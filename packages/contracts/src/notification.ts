import { z } from 'zod';

import { idSchema, paginationQuerySchema } from './common';

/**
 * Who needs to be told, and about what.
 *
 * A notification is the third kind of record this system keeps about an event,
 * and the only one addressed to a person:
 *
 *   - the **audit log** records who changed which field, for compliance;
 *   - the **activity timeline** records what happened with a client, for
 *     anyone working the record;
 *   - a **notification** says something needs *your* attention, once.
 *
 * Only the third is safe to delete, which is why this table carries a retention
 * period and no `deletedAt`. The regulated record is the audit log.
 */
export const NOTIFICATION_TYPES = [
  'LEAD_ASSIGNED',
  'LEAD_TRANSFERRED_IN',
  'LEAD_TRANSFERRED_AWAY',
  'TASK_ASSIGNED',
  'LEADS_IMPORTED',
  'BOOK_INHERITED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * How long a notification is kept.
 *
 * Ninety days, and it is a data-protection choice as much as a housekeeping
 * one: these rows name clients, so they fall under the same retention question
 * as everything else holding personal data. The audit trail keeps the permanent
 * record; nothing is lost by purging the reminder.
 */
export const NOTIFICATION_RETENTION_DAYS = 90;

export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  actorName: string | null;
  readAt: string | null;
  createdAt: string;
}

export const notificationListQuerySchema = paginationQuerySchema.extend({
  unreadOnly: z.coerce.boolean().optional(),
});
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

export const markReadSchema = z.object({ ids: z.array(idSchema).min(1).max(100) });
export type MarkReadInput = z.infer<typeof markReadSchema>;

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/** One row to be written. `userId` is the recipient, never the actor. */
export interface PlannedNotification {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
}

/** The shape the outbox hands us. Payloads are JSON, so nothing is trusted. */
export interface RoutableEvent {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: unknown;
  /** Who performed the action, when the payload records it. */
  actorId?: string | null;
}

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

const field = (payload: unknown, key: string): string | null =>
  payload !== null && typeof payload === 'object'
    ? str((payload as Record<string, unknown>)[key])
    : null;

/**
 * Which notifications an event produces.
 *
 * A pure function so the routing can be tested without a database, and so the
 * decision is written down in one place rather than spread across the services
 * that happen to emit each event.
 *
 * **The rule that matters most: never notify the actor of their own action.**
 * A rep assigning a lead to themselves must get nothing. Without this the bell
 * fills with a person's own clicks, and a bell that is always full is one
 * nobody reads — which costs more than having no bell at all.
 *
 * Events with no entry here produce nothing, deliberately. Thirteen event types
 * exist; five of them are news to somebody.
 */
export function notificationsFor(event: RoutableEvent): PlannedNotification[] {
  const actor = str(event.actorId ?? null);
  const reference = field(event.payload, 'reference') ?? event.aggregateId;
  const notMe = (userId: string | null): userId is string =>
    userId !== null && userId !== actor;

  switch (event.eventType) {
    case 'lead.assigned': {
      const to = field(event.payload, 'to');
      if (!notMe(to)) return [];
      return [
        {
          userId: to,
          type: 'LEAD_ASSIGNED',
          title: `Lead ${reference} assigned to you`,
          entityType: 'LEAD',
          entityId: event.aggregateId,
        },
      ];
    }

    case 'lead.transferred': {
      // Both sides are news. The receiver has work; the previous owner has
      // lost a lead from their book and would otherwise find out by noticing
      // it missing.
      const to = field(event.payload, 'to');
      const from = field(event.payload, 'from');
      const out: PlannedNotification[] = [];
      if (notMe(to)) {
        out.push({
          userId: to,
          type: 'LEAD_TRANSFERRED_IN',
          title: `Lead ${reference} transferred to you`,
          body: field(event.payload, 'reason') ?? undefined,
          entityType: 'LEAD',
          entityId: event.aggregateId,
        });
      }
      if (notMe(from) && from !== to) {
        out.push({
          userId: from,
          type: 'LEAD_TRANSFERRED_AWAY',
          title: `Lead ${reference} moved to another owner`,
          body: field(event.payload, 'reason') ?? undefined,
          entityType: 'LEAD',
          entityId: event.aggregateId,
        });
      }
      return out;
    }

    case 'task.assigned': {
      const to = field(event.payload, 'assigneeId');
      if (!notMe(to)) return [];
      const title = field(event.payload, 'title');
      return [
        {
          userId: to,
          type: 'TASK_ASSIGNED',
          title: title ? `Task: ${title}` : `Task ${reference} assigned to you`,
          body: field(event.payload, 'about') ?? undefined,
          entityType: 'TASK',
          entityId: event.aggregateId,
        },
      ];
    }

    case 'lead.import.committed': {
      // Only when the batch was assigned to somebody. An import the actor
      // assigned to themselves is not news to them.
      const to = field(event.payload, 'assigneeId');
      if (!notMe(to)) return [];
      const count = field(event.payload, 'created');
      return [
        {
          userId: to,
          type: 'LEADS_IMPORTED',
          title: count ? `${count} imported leads assigned to you` : 'Imported leads assigned to you',
          entityType: 'IMPORT',
          entityId: event.aggregateId,
        },
      ];
    }

    case 'user.offboarded': {
      const successor = field(event.payload, 'successorId');
      if (!notMe(successor)) return [];
      return [
        {
          userId: successor,
          type: 'BOOK_INHERITED',
          title: 'A book has been transferred to you',
          body: field(event.payload, 'summary') ?? undefined,
          entityType: 'USER',
          entityId: event.aggregateId,
        },
      ];
    }

    default:
      return [];
  }
}
