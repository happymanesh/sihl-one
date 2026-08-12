import { z } from 'zod';

import { VISIT_STATUSES } from './enums';
import { ENTITY_TYPES } from './activity';
import { idSchema, paginationQuerySchema } from './common';
import { MAX_ACCEPTABLE_ACCURACY_METRES } from './geo';

/**
 * Field-visit contracts.
 *
 * ADR-0007 governs this module: a visit is exactly two discrete location events
 * — a check-in and a check-out — and nothing in between. There is no schema
 * here in which a continuous track could be submitted, which is the point.
 */

const latitudeSchema = z.number().min(-90).max(90);
const longitudeSchema = z.number().min(-180).max(180);

/**
 * Accuracy is required, not optional.
 *
 * A coordinate without its uncertainty is not evidence — it looks identical
 * whether it came from GPS or from a cell tower five kilometres away. The
 * browser always provides it, so requiring it costs the client nothing.
 */
const accuracySchema = z
  .number()
  .positive('Location accuracy must be a positive number of metres')
  .max(
    MAX_ACCEPTABLE_ACCURACY_METRES,
    `Location accuracy is worse than ${MAX_ACCEPTABLE_ACCURACY_METRES} m, which is too imprecise to record a visit`,
  );

export const planVisitSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityId: idSchema,
  purpose: z.string().trim().min(3, 'Say what the visit is for').max(200),
  plannedAt: z.coerce.date().optional(),
});
export type PlanVisitInput = z.infer<typeof planVisitSchema>;

export const checkInSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  accuracy: accuracySchema,
  /**
   * Storage key of the selfie, uploaded separately via POST /files.
   *
   * Required. The photograph is the whole reason the module exists — a
   * check-in without one is a self-reported claim, which the CRM already
   * supports through a plain activity.
   */
  photoKey: z.string().min(1, 'A check-in photo is required').max(300),
  address: z.string().trim().max(400).optional(),
  deviceId: z.string().max(120).optional(),
  deviceInfo: z.record(z.unknown()).optional(),
});
export type CheckInInput = z.infer<typeof checkInSchema>;

export const checkOutSchema = z.object({
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  accuracy: accuracySchema,
  meetingNotes: z.string().trim().min(1, 'Record what was discussed').max(4000),
  outcome: z.string().trim().max(200).optional(),
  nextFollowUpAt: z.coerce.date().optional(),
  voiceNoteKey: z.string().max(300).optional(),
});
export type CheckOutInput = z.infer<typeof checkOutSchema>;

export const cancelVisitSchema = z.object({
  reason: z.string().trim().min(1, 'A reason is required').max(300),
});
export type CancelVisitInput = z.infer<typeof cancelVisitSchema>;

export const visitQuerySchema = paginationQuerySchema.extend({
  status: z.enum(VISIT_STATUSES).optional(),
  userId: idSchema.optional(),
  entityType: z.enum(ENTITY_TYPES).optional(),
  entityId: idSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** Restricts to visits whose location evidence needs a manager's eye. */
  needsReview: z.coerce.boolean().optional(),
});
export type VisitQuery = z.infer<typeof visitQuerySchema>;

/**
 * Allowed visit transitions. As with leads, the table is shared so the UI
 * cannot offer a move the API will reject.
 */
export const VISIT_STATUS_TRANSITIONS: Record<
  (typeof VISIT_STATUSES)[number],
  readonly (typeof VISIT_STATUSES)[number][]
> = {
  PLANNED: ['CHECKED_IN', 'CANCELLED', 'MISSED'],
  CHECKED_IN: ['COMPLETED'],
  // Terminal. A visit that happened cannot un-happen; corrections are a new visit.
  COMPLETED: [],
  CANCELLED: [],
  MISSED: [],
};

export function canTransitionVisit(
  from: (typeof VISIT_STATUSES)[number],
  to: (typeof VISIT_STATUSES)[number],
): boolean {
  return VISIT_STATUS_TRANSITIONS[from].includes(to);
}

export interface VisitListItem {
  id: string;
  reference: string;
  status: (typeof VISIT_STATUSES)[number];
  purpose: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
  user: { id: string; fullName: string } | null;
  plannedAt: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  durationMinutes: number | null;
  outcome: string | null;
  locationQuality: string;
  requiresReview: boolean;
  isOverdue: boolean;
}
