import type { EntityType } from '@sihl-one/contracts';

import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Turning a booked follow-up into a task someone will actually see.
 *
 * Setting a next follow-up used to write a date onto the lead and nothing else.
 * The date showed up in the pipeline's overdue count, but the rep's Tasks screen
 * stayed empty — so a commitment made at the end of a visit lived somewhere the
 * person who made it never looked. That is the whole defect: not a missing
 * field, a missing prompt.
 *
 * Both places that book a follow-up go through here — the end of a field visit
 * and the interaction form. They had drifted apart once already, which is how
 * one of them ended up creating no task at all.
 *
 * Deliberately not deduplicated. Booking a second follow-up while the first is
 * still open leaves two tasks, and that is the honest picture: two commitments
 * were made and neither was closed. Silently retiring the older one would hide
 * exactly the pattern a manager needs to see.
 */
export interface FollowUpTaskInput {
  reference: string;
  entityType: EntityType;
  entityId: string;
  dueAt: Date;
  /** The visit purpose or interaction subject this follow-up came out of. */
  context: string;
  /** Whoever owns the follow-through — the rep, not necessarily the actor. */
  assigneeId: string;
  createdById: string;
}

/** The column is VarChar(160); a long visit purpose must not fail the write. */
const TITLE_LIMIT = 160;
const PREFIX = 'Follow up: ';

export function followUpTaskTitle(context: string): string {
  const trimmed = context.trim();
  if (!trimmed) return 'Follow up';

  const room = TITLE_LIMIT - PREFIX.length;
  if (trimmed.length <= room) return `${PREFIX}${trimmed}`;
  // Ellipsis rather than a hard cut, so a truncated title reads as truncated
  // rather than as a sentence that stops mid-word for no reason.
  return `${PREFIX}${trimmed.slice(0, room - 1).trimEnd()}…`;
}

/** Minimal surface both PrismaService and a transaction client satisfy. */
type TaskCreator = Pick<PrismaService, 'task' | 'outboxEvent'>;

export async function createFollowUpTask(
  tx: TaskCreator,
  input: FollowUpTaskInput,
): Promise<void> {
  const title = followUpTaskTitle(input.context);
  const task = await tx.task.create({
    data: {
      reference: input.reference,
      title,
      entityType: input.entityType,
      entityId: input.entityId,
      dueAt: input.dueAt,
      assigneeId: input.assigneeId,
      createdById: input.createdById,
    },
  });

  // Written in the caller's transaction, so the task and the notice that it
  // exists either both happen or neither does — which is the entire point of
  // the outbox. The router stays silent when a rep books their own follow-up,
  // which is the overwhelmingly common case; it fires when a manager closes
  // out a visit on somebody else's behalf.
  await tx.outboxEvent.create({
    data: {
      aggregateType: 'task',
      aggregateId: task.id,
      eventType: 'task.assigned',
      payload: {
        reference: input.reference,
        title,
        assigneeId: input.assigneeId,
        actorId: input.createdById,
      },
    },
  });
}
