import { z } from 'zod';

import { idSchema } from './common';

/**
 * Who else went along.
 *
 * A rep taking a derivatives expert to a client meeting is the ordinary case
 * this exists for. The visit stays the primary rep's — see `ATTENDEE_CREDIT`
 * below — and this records who supported them.
 */

export const ATTENDEE_ROLES = ['SUPPORT', 'PRODUCT_EXPERT', 'MANAGER'] as const;
export type AttendeeRole = (typeof ATTENDEE_ROLES)[number];

export const ATTENDEE_ROLE_LABELS: Record<AttendeeRole, string> = {
  SUPPORT: 'Support',
  PRODUCT_EXPERT: 'Product expert',
  MANAGER: 'Manager',
};

/**
 * Credit is not divisible, and that is a product decision rather than a
 * simplification.
 *
 * The conversion stays with the visit's owner however many people attended.
 * The moment credit can be split it gets negotiated over before the meeting
 * and argued about after it, and a new thing to game is created. This table
 * answers "who supported", never "whose deal was it".
 */
export const ATTENDEE_CREDIT = 'owner-only' as const;

export const addAttendeeSchema = z.object({
  userId: idSchema,
  role: z.enum(ATTENDEE_ROLES).default('SUPPORT'),
});
export type AddAttendeeInput = z.infer<typeof addAttendeeSchema>;

/** Who actually turned up, submitted at check-out. */
export const confirmAttendanceSchema = z.object({
  /** Attendee ids that were present. Anything omitted is recorded as absent. */
  presentUserIds: z.array(idSchema).max(20),
});
export type ConfirmAttendanceInput = z.infer<typeof confirmAttendanceSchema>;

export interface AttendeeView {
  id: string;
  userId: string;
  fullName: string;
  employeeCode: string | null;
  role: AttendeeRole;
  /** Null until the owner confirms they came. */
  confirmedAt: string | null;
  addedAt: string;
}

/**
 * Whether this person may be added to this visit.
 *
 * A rep adds a colleague without asking a manager — that was the explicit
 * instruction, and requiring approval to bring a product expert to a meeting
 * tomorrow morning is how the feature goes unused. The two rules that remain
 * are structural rather than hierarchical.
 */
export function canAddAttendee(input: {
  visitStatus: string;
  ownerId: string;
  candidateUserId: string;
  existingUserIds: readonly string[];
}): { allowed: boolean; reason?: string } {
  // The owner is already on the visit by definition. Adding them again would
  // put them in their own support list and double-count the visit for them.
  if (input.candidateUserId === input.ownerId) {
    return { allowed: false, reason: 'The visit already belongs to this person.' };
  }
  if (input.existingUserIds.includes(input.candidateUserId)) {
    return { allowed: false, reason: 'They are already on this visit.' };
  }
  // After check-out the visit is a record of what happened. Adding somebody to
  // a finished meeting is not planning, it is rewriting history.
  if (input.visitStatus === 'COMPLETED' || input.visitStatus === 'CANCELLED') {
    return { allowed: false, reason: 'This visit is closed.' };
  }
  return { allowed: true };
}

/** Attendance is confirmed once, when the owner checks out. */
export function canConfirmAttendance(visitStatus: string): boolean {
  return visitStatus === 'CHECKED_IN';
}
