import { z } from 'zod';
import { ACTIVITY_DIRECTIONS, ACTIVITY_TYPES, PRIORITIES, TASK_STATUSES } from './enums';
import { checkMeetingLink } from './masters';
import { codeSchema, idSchema, paginationQuerySchema } from './common';

/** Polymorphic parent for an activity or task. */
export const ENTITY_TYPES = ['LEAD', 'CUSTOMER', 'PARTNER', 'OPPORTUNITY'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const createActivitySchema = z
  .object({
    entityType: z.enum(ENTITY_TYPES),
    entityId: idSchema,
    type: z.enum(ACTIVITY_TYPES),
    direction: z.enum(ACTIVITY_DIRECTIONS).default('OUTBOUND'),
    subject: z.string().trim().min(1, 'Subject is required').max(160),
    body: z.string().trim().max(4000).optional(),
    occurredAt: z.coerce.date().optional(),
    durationMinutes: z.number().int().min(0).max(600).optional(),
    outcome: z.string().trim().max(120).optional(),
    nextFollowUpAt: z.coerce.date().optional(),
    /** Code into the meeting-mode master. */
    meetingMode: codeSchema.optional(),
    meetingLink: z.string().trim().max(500).optional(),
  })
  .refine((data) => !data.occurredAt || data.occurredAt.getTime() <= Date.now() + 60_000, {
    message: 'An activity cannot be logged with a future timestamp',
    path: ['occurredAt'],
  })
  .refine((data) => !data.meetingLink || checkMeetingLink(data.meetingLink).allowed, {
    // Checked here as well as in the API so a bad link is rejected before it is
    // ever stored — this URL goes to clients from SIHL's sender identity.
    message: 'Use a link from an approved meeting provider.',
    path: ['meetingLink'],
  });
export type CreateActivityInput = z.infer<typeof createActivitySchema>;

export const activityQuerySchema = paginationQuerySchema.extend({
  entityType: z.enum(ENTITY_TYPES).optional(),
  entityId: idSchema.optional(),
  type: z.enum(ACTIVITY_TYPES).optional(),
  actorId: idSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ActivityQuery = z.infer<typeof activityQuerySchema>;

export const createTaskSchema = z.object({
  entityType: z.enum(ENTITY_TYPES).optional(),
  entityId: idSchema.optional(),
  title: z.string().trim().min(1, 'Title is required').max(160),
  description: z.string().trim().max(2000).optional(),
  assigneeId: idSchema.optional(),
  dueAt: z.coerce.date(),
  priority: z.enum(PRIORITIES).default('MEDIUM'),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  description: z.string().trim().max(2000).optional(),
  assigneeId: idSchema.optional(),
  dueAt: z.coerce.date().optional(),
  priority: z.enum(PRIORITIES).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  completionNote: z.string().trim().max(1000).optional(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const taskQuerySchema = paginationQuerySchema.extend({
  status: z.enum(TASK_STATUSES).optional(),
  assigneeId: idSchema.optional(),
  entityType: z.enum(ENTITY_TYPES).optional(),
  entityId: idSchema.optional(),
  dueBefore: z.coerce.date().optional(),
  overdueOnly: z.coerce.boolean().optional(),
});
export type TaskQuery = z.infer<typeof taskQuerySchema>;
