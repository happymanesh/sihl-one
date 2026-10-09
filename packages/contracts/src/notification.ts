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
  /** One desk's work on a lead, handed to you. See `lead.product.assigned`. */
  'LEAD_PRODUCT_ASSIGNED',
  /** A commitment waiting on your sign-off. See `lead.product.approval.*`. */
  'APPROVAL_REQUESTED',
  /** Your request was answered, either way. */
  'APPROVAL_DECIDED',
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
  const notMe = (userId: string | null): userId is string => userId !== null && userId !== actor;

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

    /*
      A product on a lead, handed to somebody.

      The event was being published and nothing routed it, so being given a
      desk's work on a client arrived silently — the receiver found out by
      opening a lead they had no reason to open. A whole-lead assignment has
      always rung the bell; this is the same news about a smaller unit of work.

      One notification whether it was one product or an "assign all" sweep:
      `productCount` is set by the bulk path and `productCode` by the single
      one, and six separate rows for one act is how a bell stops being read.
    */
    case 'lead.product.assigned': {
      const to = field(event.payload, 'assigneeId');
      if (!notMe(to)) return [];

      // The product's name where the payload carries it, its code otherwise —
      // the receiver knows it as "NRI investing", not NRI.
      const named = field(event.payload, 'productName') ?? field(event.payload, 'productCode');
      const count = Number(field(event.payload, 'productCount') ?? '0');
      const what = named ?? (count > 1 ? `${count} products` : 'A product');

      return [
        {
          userId: to,
          type: 'LEAD_PRODUCT_ASSIGNED',
          title: `${what} on lead ${reference} assigned to you`,
          entityType: 'LEAD',
          entityId: event.aggregateId,
        },
      ];
    }

    /*
      A commitment waiting on a National Head.

      Reminders route through the same case: the title says so, and the
      `sourceEventId` differs per event, so a nudge writes a fresh row rather
      than being swallowed by the duplicate guard on the original request.
    */
    case 'lead.product.approval.requested':
    case 'lead.product.approval.reminded': {
      const to = field(event.payload, 'approverId');
      if (!notMe(to)) return [];
      const product = field(event.payload, 'productName') ?? field(event.payload, 'productCode');
      const again = event.eventType.endsWith('reminded');
      return [
        {
          userId: to,
          type: 'APPROVAL_REQUESTED',
          title: `${again ? 'Still waiting: approve' : 'Approve'} ${product} on lead ${reference}`,
          body: field(event.payload, 'note') ?? undefined,
          entityType: 'LEAD',
          entityId: event.aggregateId,
        },
      ];
    }

    /*
      The answer goes back to whoever asked.

      Both outcomes are news: an approval is the go-ahead they were waiting on,
      and a refusal changes what they may promise. A refusal carries its reason
      into the body, because "rejected" on its own cannot be acted on.
    */
    case 'lead.product.approval.decided': {
      const to = field(event.payload, 'requestedById');
      if (!notMe(to)) return [];
      const product = field(event.payload, 'productName') ?? field(event.payload, 'productCode');
      const approved = field(event.payload, 'decision') === 'APPROVED';
      return [
        {
          userId: to,
          type: 'APPROVAL_DECIDED',
          title: `${product} on lead ${reference} ${approved ? 'approved' : 'not approved'}`,
          body: field(event.payload, 'reason') ?? undefined,
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
          title: count
            ? `${count} imported leads assigned to you`
            : 'Imported leads assigned to you',
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
