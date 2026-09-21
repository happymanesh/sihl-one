import { z } from 'zod';

import { idSchema, indianMobileSchema } from './common';

/**
 * Mobile verification by one-time code.
 *
 * Used at event registration, where the person is standing at a stall with
 * their phone in their hand — the one moment in the whole funnel when a number
 * can be proven rather than typed and hoped for. A number verified here is
 * worth more than every other number on the book.
 */

/** Six digits, because that is what the approved DLT template shows. */
export const OTP_LENGTH = 6;

/**
 * Ten minutes, because the registered template says ten minutes.
 *
 * The text is fixed by DLT and cannot be changed without re-registering, so the
 * code's life is set by the message rather than the other way round. Changing
 * this without changing the template would make the SMS a lie.
 */
export const OTP_TTL_MINUTES = 10;

/**
 * Wrong guesses before a code is dead.
 *
 * Six digits is a million possibilities — trivial for a script and hopeless for
 * a person, so the cap is what makes this a credential rather than a formality.
 * Five is generous for somebody squinting at a phone in a noisy hall.
 */
export const OTP_MAX_ATTEMPTS = 5;

/**
 * Codes one number may be sent in an hour.
 *
 * The capture endpoint is public and every send costs money and lands on a real
 * person's phone. Without this, the registration form is a free SMS cannon
 * pointed at any number somebody cares to type.
 */
export const OTP_MAX_SENDS_PER_HOUR = 3;

/** How long before a spent or expired code is swept away. */
export const OTP_RETENTION_HOURS = 24;

export const OTP_PURPOSES = ['EVENT_REGISTRATION'] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

/**
 * The message, exactly as registered on DLT.
 *
 * Operators match the delivered text against the approved template character
 * for character and reject anything that differs, so this is not a place for
 * improvement: no rewording, no extra punctuation, no trailing newline. The
 * only variable is the code.
 *
 * Template: "Registration LMS"
 */
export function renderOtpMessage(code: string): string {
  return (
    `${code} is your OTP to verify your mobile number for SIHL event registration. ` +
    `Valid for 10 minutes. Do not share it with anyone. - Shah Investors Home Ltd`
  );
}

/** Digits only, and exactly as many as we send. */
export const otpCodeSchema = z
  .string()
  .trim()
  .regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), `Enter the ${OTP_LENGTH}-digit code`);

/**
 * Verifying a code.
 *
 * Keyed on the verification id handed back at capture, not on the mobile
 * number. Accepting a number here would let anyone with a phone book try codes
 * against strangers, and would confirm which numbers have a code outstanding —
 * the id is unguessable and scoped to the person who submitted the form.
 */
export const verifyOtpSchema = z.object({
  verificationId: idSchema,
  code: otpCodeSchema,
});
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;

/** Asking for another code, when the first did not arrive. */
export const resendOtpSchema = z.object({
  verificationId: idSchema,
});
export type ResendOtpInput = z.infer<typeof resendOtpSchema>;

export interface OtpChallenge {
  /** Null when no code was sent — no provider configured, or the cap was hit. */
  verificationId: string | null;
  expiresInSeconds: number;
  /** Masked with `maskMobile` from ./masking, so the page can say where the
   *  code went without printing the number. */
  maskedMobile: string;
  /**
   * False when the lead was saved but no message went out. The registration
   * still succeeded; only the verification step is unavailable.
   */
  sent: boolean;
}

export interface OtpVerifyResult {
  verified: boolean;
  /** Present on failure, in words the person at the stall can act on. */
  reason: string | null;
  attemptsRemaining: number;
}

/** Shape check only; the API decides whether the number may be sent to. */
export const requestOtpSchema = z.object({
  mobile: indianMobileSchema,
  purpose: z.enum(OTP_PURPOSES),
});
export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
