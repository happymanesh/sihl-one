import { z } from 'zod';

import { DATA_SCOPES } from './enums';
import { PERMISSIONS, type Permission } from './rbac';

/**
 * A non-human caller.
 *
 * SIHL ONE has only ever been able to authenticate people: every route expects
 * a user token, and `UserType` knows about staff, partners and customers. A
 * second system that needs to read from here — the CEO command centre first,
 * and anything after it — has no way in that is not somebody's personal login.
 *
 * Giving a machine a person's credentials is the failure this exists to
 * prevent. It makes the audit trail lie about who did something, it breaks the
 * moment that person leaves, and it hands a long-lived password to a service
 * that only ever needed to count leads.
 */

/** Shown in the key so a leaked or unknown key can be identified without the secret. */
export const SERVICE_KEY_PREFIX = 'sihl_svc';

/**
 * What a service account is allowed to hold.
 *
 * Read-only, and deliberately narrow. A reporting integration needs to count
 * and aggregate; it never needs to create a lead, convert one, or read the
 * audit trail. The check is a rule rather than a convention because the
 * temptation to "just add one write permission for now" is exactly how a
 * reporting credential becomes a way to change the book.
 *
 * `audit:read` is excluded on purpose. The audit trail is the record of who did
 * what to client data, and a credential that lives in another system's
 * configuration is the wrong place to read it from.
 */
export const SERVICE_ACCOUNT_FORBIDDEN: readonly Permission[] = ['audit:read'];

export function isPermissionAllowedForService(permission: string): boolean {
  if (!(PERMISSIONS as readonly string[]).includes(permission)) return false;
  if ((SERVICE_ACCOUNT_FORBIDDEN as readonly string[]).includes(permission)) return false;
  // Read-only. `:export` is a read of many rows at once and is excluded too —
  // a bulk extract of client PII should be a person's deliberate act, attributed
  // to them, not something a background integration can do unattended.
  return permission.endsWith(':read');
}

/** The permissions a reporting integration such as the CEO command centre needs. */
export const REPORTING_PERMISSIONS: readonly Permission[] = [
  'analytics:sales:read',
  'analytics:management:read',
  'analytics:marketing:read',
  'analytics:partner:read',
];

export const createServiceAccountSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'Lowercase letters, digits and hyphens only'),
  description: z.string().trim().max(300).optional(),
  permissions: z
    .array(z.string())
    .min(1, 'A service account with no permissions can do nothing')
    .refine((list) => list.every(isPermissionAllowedForService), {
      message: 'A service account may hold read permissions only, and never audit:read',
    }),
  // Company-wide by default: a reporting integration aggregates across the
  // whole book, and narrowing it to a branch would silently under-report rather
  // than fail. Still explicit, so nobody has to infer it.
  dataScope: z.enum(DATA_SCOPES).default('ALL'),
  /**
   * Expiry is required, not optional.
   *
   * A credential with no end date is one nobody ever revisits. Forcing a date
   * means somebody looks at it again, and a key that outlives the integration
   * it was minted for stops working rather than sitting valid forever.
   */
  expiresAt: z.coerce.date(),
});
export type CreateServiceAccountInput = z.infer<typeof createServiceAccountSchema>;

export interface ServiceAccountView {
  id: string;
  name: string;
  description: string | null;
  keyPrefix: string;
  permissions: string[];
  dataScope: string;
  isActive: boolean;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** Whether a key may be used right now, and if not, why. */
export function serviceAccountUsable(
  account: { isActive: boolean; revokedAt: Date | null; expiresAt: Date },
  now: Date = new Date(),
): { usable: boolean; reason?: string } {
  if (account.revokedAt !== null) return { usable: false, reason: 'This key has been revoked.' };
  if (!account.isActive) return { usable: false, reason: 'This key is disabled.' };
  if (account.expiresAt <= now) return { usable: false, reason: 'This key has expired.' };
  return { usable: true };
}
