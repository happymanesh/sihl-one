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
 * What a visit is, unless told otherwise: the rep goes to the client.
 *
 * Matches the `CLIENT_SITE` row seeded into the meeting-mode master, and the
 * column default in the database. All three have to agree.
 */
export const DEFAULT_VISIT_MODE = 'CLIENT_SITE';

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

/**
 * The mode a visit is planned in.
 *
 * A free-form code rather than an enum, because the modes are an admin-managed
 * master — an enum here would mean a release every time the business adds one.
 * The API checks the code against that master, and the foreign key is the final
 * word, so an unknown code cannot be stored.
 */
const visitModeSchema = z
  .string()
  .trim()
  .min(1, 'Choose how this will happen')
  .max(40);

export const planVisitSchema = z.object({
  entityType: z.enum(ENTITY_TYPES),
  entityId: idSchema,
  purpose: z.string().trim().min(3, 'Say what the visit is for').max(200),
  plannedAt: z.coerce.date().optional(),
  /**
   * Optional for older callers, which planned physical visits because that was
   * the only kind. Defaulting keeps their meaning rather than inventing a new
   * one for records that already exist.
   */
  mode: visitModeSchema.optional().default(DEFAULT_VISIT_MODE),
});
export type PlanVisitInput = z.infer<typeof planVisitSchema>;

/**
 * What a mode demands at check-in.
 *
 * The flags live on the master row, set by an administrator, and this function
 * is the only place that interprets them. Both the API and the check-in screen
 * call it, so the button the rep sees and the rule the server enforces can
 * never drift apart — the failure that produces "it let me submit and then said
 * no".
 */
export interface VisitEvidenceRules {
  photo: boolean;
  geo: boolean;
  link: boolean;
  screenshot: boolean;
}

export function visitEvidenceRules(
  mode: { requiresPhoto?: boolean; requiresGeo?: boolean; requiresLink?: boolean; allowsScreenshot?: boolean } | null | undefined,
): VisitEvidenceRules {
  // An unknown mode is treated as the strictest one. If the master row cannot
  // be read, asking for a photograph that turns out to be unnecessary is a far
  // smaller failure than silently accepting a client-site visit with no
  // evidence at all.
  if (!mode) return { photo: true, geo: true, link: false, screenshot: false };

  return {
    photo: mode.requiresPhoto === true,
    geo: mode.requiresGeo === true,
    link: mode.requiresLink === true,
    screenshot: mode.allowsScreenshot === true,
  };
}

/**
 * Why a check-in has no usable location.
 *
 * Recorded rather than rejected. A rep standing in a client's basement with no
 * signal has still made the visit, and refusing the check-in produces no record
 * at all — which is worse data than a record marked unverified. The quality is
 * reported per person instead, where a pattern is visible and a single bad fix
 * is not.
 */
export const LOCATION_FAILURE_REASONS = [
  'DENIED',
  'UNAVAILABLE',
  'TIMEOUT',
  'IMPRECISE',
  'UNSUPPORTED',
] as const;
export type LocationFailureReason = (typeof LOCATION_FAILURE_REASONS)[number];

export const LOCATION_STATUSES = ['VERIFIED', 'UNVERIFIED'] as const;
export type LocationStatus = (typeof LOCATION_STATUSES)[number];

export const checkInSchema = z.object({
  /**
   * Optional, deliberately. See LOCATION_FAILURE_REASONS: a missing fix marks
   * the visit unverified rather than blocking the rep from recording it.
   */
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  accuracy: z.number().positive().optional(),
  /** Set when the device could not give a usable fix. */
  locationFailureReason: z.enum(LOCATION_FAILURE_REASONS).optional(),
  /**
   * Storage key of the photograph, uploaded separately via POST /files.
   *
   * Optional *here* and required by the server for modes that demand it. The
   * schema cannot decide alone: whether a photograph is needed depends on the
   * visit's mode, which lives in the database, not in the request. A phone call
   * planned from this screen must not demand a selfie at your own desk.
   *
   * For a client-site visit the photograph is still the whole point — a
   * check-in without one is a self-reported claim, which the CRM already
   * supports through a plain activity.
   */
  photoKey: z.string().min(1).max(300).optional(),
  address: z.string().trim().max(400).optional(),
  deviceId: z.string().max(120).optional(),
  deviceInfo: z.record(z.unknown()).optional(),
});
export type CheckInInput = z.infer<typeof checkInSchema>;

/**
 * Check-out.
 *
 * The location is optional for the same reason it is optional at check-in, and
 * more urgently: a rep who checked in from a basement must still be able to
 * close the visit. Requiring a fix here would strand the visit open forever and
 * lose the meeting notes — the most valuable thing in the whole record — to
 * protect a reading that was never going to be good.
 */
export const checkOutSchema = z.object({
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  accuracy: z.number().positive().optional(),
  locationFailureReason: z.enum(LOCATION_FAILURE_REASONS).optional(),
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
  /** Master code — stable, safe to filter and group a report on. */
  mode: string;
  /** The administrator's wording for that code, for display only. */
  modeLabel: string | null;
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

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

/**
 * A fixed list rather than a master.
 *
 * Finance maps these onto its own heads, so adding one is a conversation with
 * finance — not a self-service change that silently produces a category nothing
 * downstream knows how to post.
 */
export const EXPENSE_CATEGORIES = ['TRAVEL', 'FOOD', 'PARKING', 'ACCOMMODATION', 'OTHER'] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** Sanity ceiling. Not a policy limit — policy belongs to finance, not here. */
export const MAX_EXPENSE_CLAIM = 100_000;

export const createVisitExpenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  /**
   * Sent as a string so the rupee value never passes through a float on its way
   * in, matching how money is handled everywhere else.
   */
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,7}(\.\d{1,2})?$/, 'Enter an amount like 250 or 1250.50')
    .refine((value) => Number(value) > 0, 'An expense must be more than zero')
    .refine(
      (value) => Number(value) <= MAX_EXPENSE_CLAIM,
      `Claims above ${MAX_EXPENSE_CLAIM.toLocaleString('en-IN')} go through finance directly`,
    ),
  note: z.string().trim().max(300).optional(),
  receiptKey: z.string().trim().max(300).optional(),
});
export type CreateVisitExpenseInput = z.infer<typeof createVisitExpenseSchema>;

export interface VisitExpenseItem {
  id: string;
  category: ExpenseCategory;
  /** String, as sent. Formatting is the caller's business. */
  amount: string;
  note: string | null;
  hasReceipt: boolean;
  claimedAt: string;
}

/**
 * Total of a set of claims, as a string.
 *
 * Summed in paise as integers rather than adding floats: 0.1 + 0.2 is famously
 * not 0.3, and this figure goes to finance.
 */
export function totalExpenseClaim(amounts: readonly string[]): string {
  const paise = amounts.reduce((sum, amount) => sum + Math.round(Number(amount) * 100), 0);
  return (paise / 100).toFixed(2);
}

/**
 * Is this check-in's location good enough to count as evidence?
 *
 * A fix with 3,000 m of uncertainty looks identical in the database to a good
 * one, and is worthless for confirming someone was at a client's premises. It is
 * recorded either way — but only an accurate fix is called verified, so the
 * reported rate means something.
 */
export function assessCheckInLocation(input: {
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  locationFailureReason?: LocationFailureReason;
}): { status: LocationStatus; reason: LocationFailureReason | null } {
  if (input.locationFailureReason) {
    return { status: 'UNVERIFIED', reason: input.locationFailureReason };
  }
  if (input.latitude === undefined || input.longitude === undefined) {
    return { status: 'UNVERIFIED', reason: 'UNAVAILABLE' };
  }
  if (input.accuracy === undefined || input.accuracy > VERIFIED_ACCURACY_METRES) {
    return { status: 'UNVERIFIED', reason: 'IMPRECISE' };
  }
  return { status: 'VERIFIED', reason: null };
}

/**
 * Above this, a fix is recorded but not treated as confirming presence.
 *
 * Far tighter than MAX_ACCEPTABLE_ACCURACY_METRES, which existed to reject a
 * check-in outright. Nothing is rejected now, so this threshold can say what it
 * actually means: close enough to place someone at a building.
 */
export const VERIFIED_ACCURACY_METRES = 100;
