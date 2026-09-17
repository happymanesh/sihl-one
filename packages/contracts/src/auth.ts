import { z } from 'zod';
import { DATA_SCOPES, ROLES, USER_TYPES } from './enums';
import { PERMISSIONS } from './rbac';
import { emailSchema, idSchema, indianMobileSchema } from './common';

/**
 * Password policy.
 *
 * Deliberately length-first rather than a maze of character classes: NIST
 * SP 800-63B guidance, and it is what actually resists credential stuffing.
 * The character-class rules are kept as a floor because SEBI/CERT-In audit
 * checklists in India still look for them explicitly.
 */
export const PASSWORD_MIN_LENGTH = 12;

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/\d/, 'Password must contain a digit')
  .regex(/[^A-Za-z0-9]/, 'Password must contain a special character');

export const loginSchema = z.object({
  /** Email or mobile — resolved server-side so the UI needs one field. */
  identifier: z.string().trim().min(3).max(120),
  password: z.string().min(1, 'Password is required').max(128),
  /** Opaque device fingerprint from the client, used for device management. */
  deviceId: z.string().max(120).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const registerSchema = z
  .object({
    firstName: z.string().trim().min(1).max(60),
    lastName: z.string().trim().min(1).max(60),
    email: emailSchema,
    mobile: indianMobileSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    acceptedTerms: z.literal(true, {
      errorMap: () => ({ message: 'You must accept the terms to continue' }),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: 'New password must be different from the current password',
    path: ['newPassword'],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/**
 * Asking for a reset link.
 *
 * Takes the same identifier the sign-in box does — email, mobile or employee
 * code — because somebody who cannot remember their password is not in a state
 * to be told they also used the wrong kind of identifier.
 */
export const forgotPasswordSchema = z.object({
  identifier: z.string().trim().min(3, 'Enter your email, mobile or employee code').max(160),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/**
 * Spending the link.
 *
 * No current password: the whole point is that the person does not have one
 * they can use. The token is the proof, which is why it is single-use, short
 * lived, and why a successful reset ends every existing session.
 */
export const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(20).max(200),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/**
 * How long a reset link is good for.
 *
 * Half an hour is long enough to find the email on another device and short
 * enough that a link sitting in an inbox overnight is already dead.
 */
export const PASSWORD_RESET_TTL_MINUTES = 30;

/** Claims carried in the access token. Kept small — tokens travel a lot. */
export const accessTokenClaimsSchema = z.object({
  sub: idSchema,
  typ: z.enum(USER_TYPES),
  roles: z.array(z.enum(ROLES)).min(1),
  perms: z.array(z.enum(PERMISSIONS)),
  scope: z.enum(DATA_SCOPES),
  /** Org unit the user is anchored to; drives ABAC filtering. */
  ou: idSchema.nullable(),
  /** Session id — lets us revoke a single device without a global logout. */
  sid: idSchema,
  iss: z.string(),
  aud: z.string(),
  iat: z.number(),
  exp: z.number(),
});
export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;

export const authenticatedUserSchema = z.object({
  id: idSchema,
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  mobile: z.string().nullable(),
  userType: z.enum(USER_TYPES),
  roles: z.array(z.enum(ROLES)),
  permissions: z.array(z.enum(PERMISSIONS)),
  dataScope: z.enum(DATA_SCOPES),
  orgUnitId: idSchema.nullable(),
  orgUnitName: z.string().nullable(),
  mustChangePassword: z.boolean(),
  avatarUrl: z.string().nullable(),
});
export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;

export const authTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int(),
  tokenType: z.literal('Bearer'),
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

export const loginResponseSchema = z.object({
  user: authenticatedUserSchema,
  tokens: authTokensSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;
