import { z } from 'zod';

/**
 * Two-factor authentication.
 *
 * TOTP (RFC 6238) rather than SMS. SIHL's users are being protected from
 * credential stuffing and phishing, and SIM-swap is a routine attack against
 * Indian broking accounts specifically — an OTP delivered to a number an
 * attacker has just ported is not a second factor.
 *
 * Two rules shape everything here.
 *
 * **The secret is not stored until a code from it has been verified.** Writing
 * it at setup time locks out anyone who scans the QR and then closes the tab
 * before finishing, and they cannot tell you what went wrong.
 *
 * **Recovery codes are shown exactly once.** They are the answer to a lost
 * phone, which is the single most common way MFA turns into a support ticket.
 * Storing them retrievably would make them a second password, kept in plain
 * sight, with none of the password's protections.
 */

/** Digits in a TOTP code. */
export const TOTP_DIGITS = 6;

/** Seconds each code is valid for. */
export const TOTP_PERIOD = 30;

/**
 * How many periods either side of now are accepted.
 *
 * One step — thirty seconds of tolerance in each direction. Enough for a phone
 * whose clock has drifted slightly or a user who types slowly; not so much that
 * a code shoulder-surfed a minute ago still works.
 */
export const TOTP_WINDOW = 1;

export const MFA_RECOVERY_CODE_COUNT = 10;

/**
 * Alphabet for recovery codes — the same one the partner referral codes use,
 * and for the same reason: these get written on paper and read back under
 * stress, when a phone has just been lost.
 */
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Characters per group, and groups per code: `XXXXX-XXXXX`. */
const GROUP_SIZE = 5;
const GROUPS = 2;

/**
 * Generates one recovery code.
 *
 * Ten characters from a 31-symbol alphabet is roughly 49 bits — far beyond
 * guessing at any rate the endpoint permits, and short enough to write down.
 * `randomInt` is injected so the caller supplies a cryptographic source; this
 * package also runs in the browser and must not reach for `node:crypto`.
 */
export function generateRecoveryCode(randomInt: (maxExclusive: number) => number): string {
  const groups: string[] = [];
  for (let group = 0; group < GROUPS; group += 1) {
    let chunk = '';
    for (let index = 0; index < GROUP_SIZE; index += 1) {
      chunk += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    }
    groups.push(chunk);
  }
  return groups.join('-');
}

export function generateRecoveryCodes(
  randomInt: (maxExclusive: number) => number,
  count = MFA_RECOVERY_CODE_COUNT,
): string[] {
  const codes = new Set<string>();

  // A duplicate would silently reduce the count, and the hash column is unique
  // so it would also fail the insert — so redraw. Bounded, because an unbounded
  // retry loop hangs forever on a degenerate random source instead of failing,
  // and a hang inside enrolment is far harder to diagnose than an error.
  const maxAttempts = count * 20;
  for (let attempt = 0; codes.size < count && attempt < maxAttempts; attempt += 1) {
    codes.add(generateRecoveryCode(randomInt));
  }

  if (codes.size < count) {
    throw new Error(
      `Could not generate ${count} distinct recovery codes — the random source is not varied enough.`,
    );
  }

  return [...codes];
}

/** Strips formatting so `abcde fghij` and `ABCDE-FGHIJ` are the same code. */
export function normaliseRecoveryCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export const totpCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s/g, ''))
  .pipe(
    z
      .string()
      .regex(new RegExp(`^\\d{${TOTP_DIGITS}}$`), `Enter the ${TOTP_DIGITS}-digit code`),
  );

/** Either a TOTP code or a recovery code — the challenge accepts both. */
export const mfaAnswerSchema = z.object({
  challengeToken: z.string().min(10).max(2000),
  code: z.string().trim().min(6).max(20),
});
export type MfaAnswerInput = z.infer<typeof mfaAnswerSchema>;

export const enableMfaSchema = z.object({
  /** The secret handed out by setup, returned so nothing half-enrolled persists. */
  secret: z.string().trim().min(16).max(255),
  code: totpCodeSchema,
});
export type EnableMfaInput = z.infer<typeof enableMfaSchema>;

export const disableMfaSchema = z.object({
  /**
   * Password *and* a current code.
   *
   * Turning MFA off is the one action that undoes the protection, so it has to
   * prove both factors. A session hijacked after sign-in could otherwise
   * disable it and lock the real owner out permanently.
   */
  password: z.string().min(1, 'Your password is required'),
  code: z.string().trim().min(6).max(20),
});
export type DisableMfaInput = z.infer<typeof disableMfaSchema>;

/**
 * An administrator clearing somebody else's second factor.
 *
 * The escape hatch for a lost phone *and* lost recovery codes, which is
 * otherwise a permanent lockout. Deliberately not self-service: `disable`
 * proves both factors, this one proves neither, so allowing it on your own
 * account would turn a hijacked admin session into a way to shed MFA without
 * knowing the password.
 */
export const resetMfaSchema = z.object({
  reason: z.string().trim().min(5, 'Record why this is being reset').max(300),
});
export type ResetMfaInput = z.infer<typeof resetMfaSchema>;

export interface MfaSetupResponse {
  /** Base32, shown so a user without a camera can type it in. */
  secret: string;
  /** `otpauth://` URI for the QR code. */
  otpauthUri: string;
  issuer: string;
  accountName: string;
}

export interface MfaEnabledResponse {
  enabled: true;
  /** Shown once and never again. */
  recoveryCodes: string[];
}

export interface MfaStatus {
  enabled: boolean;
  enrolledAt: string | null;
  recoveryCodesRemaining: number;
}

export const mfaChallengeResponseSchema = z.object({
  mfaRequired: z.literal(true),
  challengeToken: z.string(),
  expiresInSeconds: z.number(),
});
export type MfaChallengeResponse = z.infer<typeof mfaChallengeResponseSchema>;

/** A login either completes or asks for the second factor. */
export function isMfaChallenge(value: unknown): value is MfaChallengeResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { mfaRequired?: unknown }).mfaRequired === true
  );
}
