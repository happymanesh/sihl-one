import { z } from 'zod';

import { idSchema } from './common';

/**
 * Training sessions, under Training & Test.
 *
 * Deliberately independent of Test: a branch runs training nobody is examined
 * on, and sets exams on material nobody was trained for. Neither waits for the
 * other to be useful.
 */
export const TRAINING_STATUSES = ['SCHEDULED', 'CANCELLED', 'RESCHEDULED'] as const;
export type TrainingStatus = (typeof TRAINING_STATUSES)[number];

/**
 * Whether a scheduled thing has finished, and so become a record rather than a
 * plan.
 *
 * The rule behind "editable until it ends" — asked for on training and on the
 * event presentation slot, which is why it lives here and not in either one.
 * Both are a start time plus a duration, so both get the same answer from the
 * same function instead of two slightly different readings of the same
 * sentence.
 *
 * `now` is passed in rather than read, so the server and the screen can agree:
 * a button that disappears a minute before the API would refuse it is its own
 * kind of bug.
 */
export function hasFinished(
  startsAt: string | Date,
  durationMinutes: number,
  now: Date,
): boolean {
  const start = typeof startsAt === 'string' ? new Date(startsAt) : startsAt;
  return now.getTime() >= start.getTime() + durationMinutes * 60_000;
}

/** Still editable: not finished, and not already cancelled. */
export function canEditTraining(
  training: { startsAt: string; durationMinutes: number; status: TrainingStatus },
  now: Date,
): boolean {
  if (training.status === 'CANCELLED') return false;
  return !hasFinished(training.startsAt, training.durationMinutes, now);
}

export const createTrainingSchema = z.object({
  topic: z.string().trim().min(3, 'Give the session a topic').max(160),
  /** ISO instant. The form sends a local datetime; the client converts. */
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: z.coerce.number().int().min(5).max(600).default(30),
  /** A guest trainer has no login, so the name stands on its own. */
  presenterName: z.string().trim().max(120).optional(),
  presenterId: idSchema.optional(),
  remarks: z.string().trim().max(2000).optional(),
  /** At least one: a session for nobody is a session nobody can find. */
  branchIds: z.array(idSchema).min(1, 'Choose at least one branch').max(100),
});
export type CreateTrainingInput = z.infer<typeof createTrainingSchema>;

export const updateTrainingSchema = createTrainingSchema.partial().extend({
  status: z.enum(TRAINING_STATUSES).optional(),
});
export type UpdateTrainingInput = z.infer<typeof updateTrainingSchema>;

export interface TrainingMaterialView {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
}

export interface TrainingView {
  id: string;
  topic: string;
  startsAt: string;
  durationMinutes: number;
  /** Start plus duration, so a reader does not have to do the arithmetic. */
  endsAt: string;
  presenterName: string | null;
  presenterId: string | null;
  remarks: string | null;
  status: TrainingStatus;
  branches: Array<{ id: string; name: string }>;
  material: TrainingMaterialView[];
  createdBy: string;
  createdAt: string;
  /**
   * Whether this session can still be changed.
   *
   * Computed on the server against its clock, so a browser with a wrong clock
   * cannot talk itself into showing an Edit button the API will refuse.
   */
  editable: boolean;
}

export const trainingQuerySchema = z.object({
  /** Upcoming by default: the list is used to plan, not to browse history. */
  scope: z.enum(['UPCOMING', 'PAST', 'ALL']).default('UPCOMING'),
  branchId: idSchema.optional(),
  q: z.string().trim().max(120).optional(),
});
export type TrainingQuery = z.infer<typeof trainingQuerySchema>;
