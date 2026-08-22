import { z } from 'zod';
import { ACTIVITY_DIRECTIONS, ACTIVITY_TYPES, PRIORITIES, TASK_STATUSES } from './enums';
import { checkMeetingLink } from './masters';
import { codeSchema, idSchema, paginationQuerySchema } from './common';

/** Polymorphic parent for an activity or task. */
export const ENTITY_TYPES = ['LEAD', 'CUSTOMER', 'PARTNER', 'OPPORTUNITY'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

// ---------------------------------------------------------------------------
// Expected brokerage, per product

/**
 * The ceiling on a single product line.
 *
 * Not a business rule so much as a typo guard: a rep who means 25,000 and types
 * an extra zero should be stopped at the form, not discovered in a pipeline
 * report three weeks later.
 */
export const MAX_EXPECTED_BROKERAGE = 10_000_000;

/**
 * What a rep expects this conversation to earn, for one product.
 *
 * An estimate, and named one everywhere it appears. ADR-0002 puts brokerage in
 * the back office: that system knows what was actually charged, and this one
 * knows what a salesperson believed on a Tuesday. Letting the two wear the same
 * word is how a forecast ends up quoted as revenue in a meeting, so nothing
 * here is ever called "brokerage" alone.
 */
export const activityProductValueSchema = z.object({
  /** Code into the product master. */
  productCode: codeSchema,
  /**
   * Sent as a string so the rupee value never passes through a float, matching
   * how money is handled everywhere else in the system.
   */
  expectedBrokerage: z
    .string()
    .trim()
    .regex(/^\d{1,9}(\.\d{1,2})?$/, 'Enter an amount like 5000 or 12500.50')
    .refine((value) => Number(value) >= 0, 'An expected amount cannot be negative')
    .refine(
      (value) => Number(value) <= MAX_EXPECTED_BROKERAGE,
      `Above ${MAX_EXPECTED_BROKERAGE.toLocaleString('en-IN')} this is almost certainly a typo`,
    ),
});
export type ActivityProductValueInput = z.infer<typeof activityProductValueSchema>;

export interface ActivityProductValueItem {
  productCode: string;
  productName: string | null;
  /** String, as stored. Formatting is the caller's business. */
  expectedBrokerage: string;
}

/**
 * Total across product lines, as a string.
 *
 * Sums paise as integers: 0.1 + 0.2 is not 0.3 in binary floating point, and
 * this figure is read as money.
 */
export function totalExpectedBrokerage(amounts: readonly string[]): string {
  const paise = amounts.reduce((sum, amount) => sum + Math.round(Number(amount) * 100), 0);
  return (paise / 100).toFixed(2);
}

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
    /**
     * Which products were discussed, and what the rep expects each to earn.
     * Optional throughout: most interactions are not a pitch, and forcing a
     * number produces invented ones.
     */
    productValues: z.array(activityProductValueSchema).max(12).optional(),
  })
  .refine(
    (data) => {
      const codes = (data.productValues ?? []).map((entry) => entry.productCode);
      return codes.length === new Set(codes).size;
    },
    {
      // Two lines for one product would silently double the forecast.
      message: 'Each product can appear only once.',
      path: ['productValues'],
    },
  )
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
