import { z } from 'zod';

import { DATA_SCOPES, ROLES, USER_TYPES, type DataScope } from './enums';
import { emailSchema, idSchema, indianMobileSchema } from './common';

/**
 * Sales hierarchy.
 *
 * Designations are **data, not code**, and that is the whole point. Your six
 * levels look like roles but are not: a Regional Head and a Zonal Head do the
 * same things — read leads, assign leads, view analytics — and differ only in
 * how much they can see. Modelling them as roles would duplicate one permission
 * list six times and again for every "Area Manager" or "Cluster Head" the
 * company invents.
 *
 * The requirement that Regional and Zonal are optional settles it. A hierarchy
 * with skippable levels cannot be a fixed enum with fixed parent-child rules.
 *
 * Three separate concepts, deliberately:
 *   Role        — what may they do            (permissions)
 *   DataScope   — which rows may they see     (ABAC)
 *   Designation — where do they sit           (this file)
 */

/** Higher number means more senior. Gaps left so levels can be slotted between. */
export const DESIGNATION_SEED = [
  { code: 'SALES_EXECUTIVE', name: 'Sales Executive', level: 10, defaultScope: 'SELF', isActive: true },
  { code: 'SALES_TEAM_LEADER', name: 'Sales Team Leader', level: 20, defaultScope: 'TEAM', isActive: true },
  // Seeded inactive: available the moment the company needs it, invisible until then.
  { code: 'AREA_MANAGER', name: 'Area Manager', level: 30, defaultScope: 'BRANCH', isActive: false },
  { code: 'SALES_MANAGER', name: 'Sales Manager', level: 40, defaultScope: 'BRANCH', isActive: true },
  { code: 'REGIONAL_HEAD', name: 'Regional Head', level: 60, defaultScope: 'REGION', isActive: true },
  { code: 'ZONAL_HEAD', name: 'Zonal Head', level: 80, defaultScope: 'ZONE', isActive: true },
  { code: 'NATIONAL_HEAD', name: 'National Head', level: 100, defaultScope: 'ALL', isActive: true },
] as const satisfies ReadonlyArray<{
  code: string;
  name: string;
  level: number;
  defaultScope: DataScope;
  isActive: boolean;
}>;

export const createDesignationSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{2,39}$/, 'Use uppercase letters, digits and underscores'),
  name: z.string().trim().min(2).max(80),
  /**
   * Deliberately not auto-numbered. Whoever inserts a level has to decide where
   * it sits relative to the others, and a gap-based scheme makes that a choice
   * rather than a renumbering exercise.
   */
  level: z.number().int().min(1).max(1000),
  defaultScope: z.enum(DATA_SCOPES),
  isActive: z.boolean().default(true),
  /**
   * May people at this level see events and their own registration QR?
   *
   * ANDed with the same switch on their branch, so this alone grants nothing.
   * Off by default: a level that arrived switched on would widen what existing
   * users can see the moment it is created.
   */
  canAccessEvents: z.boolean().default(false),
});
export type CreateDesignationInput = z.infer<typeof createDesignationSchema>;

export const updateDesignationSchema = createDesignationSchema.partial().omit({ code: true });
export type UpdateDesignationInput = z.infer<typeof updateDesignationSchema>;

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/**
 * Employee code — the join key for the future HR feed.
 *
 * Deliberately permissive on format: it has to match whatever HR already uses,
 * and inventing a pattern now guarantees a mismatch later.
 */
export const employeeCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, 'Employee code is too short')
  .max(24)
  .regex(/^[A-Z0-9][A-Z0-9/-]*$/, 'Use letters, digits, hyphens and slashes only');

// ---------------------------------------------------------------------------
// Generated identity

/** Where staff email lives. Partners keep their own address. */
export const WORK_EMAIL_DOMAIN = 'sihl.in';

/** Prefix for generated staff codes: SIHL-0001. */
export const STAFF_CODE_PREFIX = 'SIHL';

export function formatStaffCode(sequence: number): string {
  return `${STAFF_CODE_PREFIX}-${String(sequence).padStart(4, '0')}`;
}

/**
 * The local part of a work address, from a person's name.
 *
 * Strips accents and anything that is not a letter or digit, because an address
 * has to survive being read down a phone line and typed by someone else.
 * Multi-word names close up rather than growing more dots: "Anita Rani Sharma"
 * is anita.ranisharma, not anita.rani.sharma, so the shape stays predictable.
 */
function emailLocalPart(firstName: string, lastName: string): string {
  const clean = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');

  const first = clean(firstName);
  const last = clean(lastName);

  if (!first && !last) return '';
  if (!last) return first;
  if (!first) return last;
  return `${first}.${last}`;
}

/**
 * A work address for a new joiner, avoiding ones already issued.
 *
 * Collisions are real — SIHL will hire a second Rahul Mehta — so the caller
 * passes the addresses already in use and gets the first free variant:
 * rahul.mehta, then rahul.mehta2, rahul.mehta3. Deliberately not
 * rahul.mehta1: the first person of a name has no numeral, and starting at 2
 * keeps that true.
 *
 * Returns null when the name yields nothing usable, so the caller asks rather
 * than inventing an address like `@sihl.in` with an empty local part.
 */
export function suggestWorkEmail(
  firstName: string,
  lastName: string,
  taken: readonly string[] = [],
): string | null {
  const local = emailLocalPart(firstName, lastName);
  if (!local) return null;

  const used = new Set(taken.map((value) => value.trim().toLowerCase()));

  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidate = `${local}${suffix === 0 ? '' : suffix + 1}@${WORK_EMAIL_DOMAIN}`;
    if (!used.has(candidate)) return candidate;
  }

  // A hundred people sharing one name is not a naming problem any more.
  return null;
}

export const createUserSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  /**
   * Optional for staff: left out, the server generates
   * firstname.lastname@sihl.in. Partners must supply their own address —
   * they are not SIHL staff and do not get SIHL mail.
   */
  email: emailSchema.optional(),
  mobile: indianMobileSchema.optional(),
  /**
   * Generated for staff (SIHL-0001) when absent. Required for partners, where
   * it is the code the back office already issued them — see the refinement
   * below for why it is not generated on their behalf.
   */
  employeeCode: employeeCodeSchema.optional(),
  designationId: idSchema,
  roleCodes: z.array(z.enum(ROLES)).min(1, 'Choose at least one role').max(4),
  orgUnitId: idSchema,
  managerId: idSchema.optional(),
  /**
   * Optional override. Only ever narrows the designation's default — widening
   * is silently ignored, which is the same rule effectiveScope() applies to
   * role defaults.
   */
  dataScope: z.enum(DATA_SCOPES).optional(),
  userType: z.enum(USER_TYPES).default('INTERNAL'),
})
  .superRefine((input, ctx) => {
    if (input.userType !== 'PARTNER') return;

    // A partner already has an identity in the back office, where brokerage and
    // payouts are actually recorded. Minting a second one here would create two
    // codes for one firm that somebody has to reconcile by hand every time a
    // number is questioned.
    if (!input.employeeCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter the partner's code from the back office, for example R0018.",
        path: ['employeeCode'],
      });
    }

    if (!input.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Partners sign in with their own email address, so it has to be entered.',
        path: ['email'],
      });
    }
  });
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  firstName: z.string().trim().min(1).max(60).optional(),
  lastName: z.string().trim().min(1).max(60).optional(),
  mobile: indianMobileSchema.optional(),
  employeeCode: employeeCodeSchema.optional(),
  designationId: idSchema.optional(),
  roleCodes: z.array(z.enum(ROLES)).min(1).max(4).optional(),
  orgUnitId: idSchema.optional(),
  managerId: idSchema.nullable().optional(),
  dataScope: z.enum(DATA_SCOPES).nullable().optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

// ---------------------------------------------------------------------------
// Privilege-escalation guards
// ---------------------------------------------------------------------------

export interface ActorContext {
  /** Null when the actor holds no designation (an admin or ops account). */
  designationLevel: number | null;
  /** Materialised path of the actor's org unit. */
  orgUnitPath: string | null;
  permissions: readonly string[];
  /** True for admins, who bypass the hierarchy checks entirely. */
  isUnrestricted: boolean;
}

export interface TargetContext {
  designationLevel: number;
  orgUnitPath: string | null;
  roleCodes: readonly string[];
}

export type EscalationCheck = { allowed: true } | { allowed: false; reason: string };

/**
 * May this person create or edit that person?
 *
 * Three guards, and all three exist because of the same attack: without them a
 * Sales Manager can create a National Head account and hand themselves
 * company-wide access through a second login. The escalation is trivial and
 * completely invisible in an audit of *their own* account.
 *
 * Admins bypass these checks — someone has to be able to create the first
 * National Head — which is why `isUnrestricted` is explicit rather than
 * inferred from a level of zero.
 */
export function canManageUserAt(actor: ActorContext, target: TargetContext): EscalationCheck {
  if (actor.isUnrestricted) return { allowed: true };

  // 1. Never create or edit a peer or a senior.
  if (actor.designationLevel === null) {
    return {
      allowed: false,
      reason: 'You have no designation, so you cannot manage other users.',
    };
  }
  if (target.designationLevel >= actor.designationLevel) {
    return {
      allowed: false,
      reason:
        'You can only manage people at a designation below your own. Ask an administrator to ' +
        'create someone at or above your level.',
    };
  }

  // 2. Never reach outside your own part of the organisation.
  if (!actor.orgUnitPath) {
    return { allowed: false, reason: 'You are not attached to a branch, so you cannot manage users.' };
  }
  if (!target.orgUnitPath || !target.orgUnitPath.startsWith(actor.orgUnitPath)) {
    return {
      allowed: false,
      reason: 'You can only manage people within your own branch or below it.',
    };
  }

  return { allowed: true };
}

/**
 * May this person grant these roles?
 *
 * You cannot hand out authority you do not hold. Without this, the level and
 * org-unit guards are bypassable by creating a junior with a powerful role.
 */
export function canGrantRoles(
  actorPermissions: readonly string[],
  rolePermissions: Record<string, readonly string[]>,
  roleCodes: readonly string[],
  isUnrestricted: boolean,
): EscalationCheck {
  if (isUnrestricted) return { allowed: true };

  const granted = new Set(actorPermissions);
  for (const roleCode of roleCodes) {
    const required = rolePermissions[roleCode] ?? [];
    const missing = required.filter((permission) => !granted.has(permission));
    if (missing.length > 0) {
      return {
        allowed: false,
        reason: `You cannot grant "${roleCode}" — it includes permissions you do not hold (${missing
          .slice(0, 3)
          .join(', ')}).`,
      };
    }
  }
  return { allowed: true };
}

/**
 * Is this a valid reporting line?
 *
 * "Strictly more senior", never "exactly one level up". That is what makes
 * Regional and Zonal optional: a Sales Manager may report straight to a Zonal
 * Head where no Regional Head exists, and the model must not force a phantom
 * level in between.
 */
export function validateReportingLine(
  reportLevel: number,
  managerLevel: number | null,
): EscalationCheck {
  if (managerLevel === null) return { allowed: true };

  if (managerLevel <= reportLevel) {
    return {
      allowed: false,
      reason: 'A manager must hold a more senior designation than the person reporting to them.',
    };
  }
  return { allowed: true };
}

/**
 * Effective scope for a user: the narrower of their designation's default and
 * any per-user override. Widening through the override is ignored rather than
 * rejected, so a mis-keyed edit degrades to less access, never more.
 */
export function scopeForDesignation(
  designationDefault: DataScope,
  requested?: DataScope | null,
): DataScope {
  if (!requested) return designationDefault;
  const order = DATA_SCOPES as readonly DataScope[];
  return order.indexOf(requested) < order.indexOf(designationDefault)
    ? designationDefault
    : requested;
}

export interface DesignationSummary {
  id: string;
  code: string;
  name: string;
  level: number;
  defaultScope: string;
  isActive: boolean;
  canAccessEvents: boolean;
  userCount?: number;
}

export interface UserSummary {
  id: string;
  reference: string;
  fullName: string;
  email: string;
  employeeCode: string | null;
  status: string;
  designation: { id: string; name: string; level: number } | null;
  orgUnit: { id: string; name: string } | null;
  manager: { id: string; fullName: string } | null;
  roles: string[];
  dataScope: string;
  isHrManaged: boolean;
  directReports: number;
}
