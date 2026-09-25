import { z } from 'zod';

import { idSchema } from './common';

/**
 * Talks at an event, and the seats visitors book at them.
 *
 * The form shows a date and a time; everything below carries one instant. The
 * split belongs to the input, not to the data — two fields that can disagree
 * produce a talk at midnight on the wrong day, and no amount of validation
 * downstream recovers from that.
 */

/** Ten hours. Long enough for anything real, short enough to catch a typo. */
export const SLOT_MAX_DURATION_MINUTES = 600;

/** Matches the database CHECK, so the two cannot drift apart. */
export const presentationSlotDurationSchema = z.coerce
  .number()
  .int()
  .min(1, 'Enter how long the talk runs, in minutes')
  .max(SLOT_MAX_DURATION_MINUTES, 'That is longer than ten hours — check the minutes');

export const createPresentationSlotSchema = z.object({
  startsAt: z.coerce.date(),
  durationMinutes: presentationSlotDurationSchema,
  topic: z.string().trim().min(1, 'Give the talk a topic').max(160),
  presenterName: z.string().trim().max(120).optional(),
  /**
   * Seats. Optional, and nothing enforces it yet.
   *
   * Accepted now so the column fills as events are set up, rather than being
   * backfilled later against slots that already have bookings.
   */
  capacity: z.coerce.number().int().positive().max(100_000).optional(),
});
export type CreatePresentationSlotInput = z.infer<typeof createPresentationSlotSchema>;

/**
 * Editing a slot, including switching it off.
 *
 * `isActive` is here rather than on its own endpoint because cancelling a talk
 * and correcting its time are the same act from the desk: somebody is fixing
 * the schedule. The bookings are untouched either way.
 */
export const updatePresentationSlotSchema = createPresentationSlotSchema.partial().extend({
  isActive: z.coerce.boolean().optional(),
});
export type UpdatePresentationSlotInput = z.infer<typeof updatePresentationSlotSchema>;

/**
 * What a visitor books, from the acknowledgement screen.
 *
 * Several slots at once, because the picker is a list of checkboxes and one
 * submission is one decision. The email rides along because that screen is the
 * only moment a visitor who skipped it at registration is willing to give one.
 */
export const bookPresentationSchema = z.object({
  /**
   * Proves the booking belongs to a registration whose number was confirmed.
   *
   * A signed token rather than the verification id it grew out of: the OTP row
   * only exists when a code was actually sent, and a returning client whose
   * number was already proven is sent none. Sizing this as an id — the mistake
   * the first draft made — also rejects every real token, since a signed one
   * runs to several hundred characters.
   */
  bookingToken: z.string().min(20).max(2048),
  slotIds: z.array(idSchema).min(1, 'Choose at least one talk').max(20),
  email: z.string().trim().email('Enter a valid email address').optional(),
});
export type BookPresentationInput = z.infer<typeof bookPresentationSchema>;

/** Opening or closing an event's schedule to visitors. */
export const setPresentationBookingSchema = z.object({
  enabled: z.coerce.boolean(),
});
export type SetPresentationBookingInput = z.infer<typeof setPresentationBookingSchema>;

/** One talk, as the admin screens and the picker both show it. */
export interface PresentationSlotSummary {
  id: string;
  startsAt: string;
  durationMinutes: number;
  topic: string;
  presenterName: string | null;
  capacity: number | null;
  isActive: boolean;
  /** Seats taken. The number the "Registered" link opens. */
  registered: number;
}

/**
 * The schedule, grouped the way the event screen reads it.
 *
 * Grouped on the server rather than in the component: the boundary between one
 * day and the next depends on the timezone the business works in, and deciding
 * that in two places is how a 9pm talk lands under the wrong heading in one of
 * them.
 */
export interface PresentationDay {
  /** YYYY-MM-DD, in the business timezone. */
  date: string;
  slots: PresentationSlotSummary[];
}

/** A visitor who booked, for the drill-down and its CSV. */
export interface PresentationAttendee {
  leadId: string;
  reference: string;
  fullName: string;
  mobileMasked: string;
  email: string | null;
  bookedAt: string;
}

/** What the visitor is told once the booking lands. */
export interface PresentationBookingResult {
  booked: Array<{
    slotId: string;
    startsAt: string;
    topic: string;
    presenterName: string | null;
    durationMinutes: number;
  }>;
  /** Asked for but not taken — a slot that filled, closed or was cancelled. */
  skipped: number;
  /** Whether a confirmation was actually sent, rather than merely attempted. */
  emailed: boolean;
}
