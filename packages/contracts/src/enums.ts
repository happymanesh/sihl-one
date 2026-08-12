/**
 * Domain enumerations.
 *
 * These are the single source of truth. The Prisma schema mirrors them and a
 * contract test (`test/enums.test.ts`) asserts the two never drift apart — a
 * mismatch between the DB enum and the API enum is one of the easiest ways to
 * ship a 500 to production, so it is checked rather than trusted.
 */

export const USER_TYPES = ['INTERNAL', 'PARTNER', 'CUSTOMER'] as const;
export type UserType = (typeof USER_TYPES)[number];

export const ROLES = [
  'SUPER_ADMIN',
  'MANAGEMENT',
  'OPERATIONS',
  'MARKETING',
  'SALES_MANAGER',
  'SALES_EXECUTIVE',
  'PARTNER',
  'CUSTOMER',
] as const;
export type Role = (typeof ROLES)[number];

/**
 * ABAC data scope. Deliberately mirrors the hierarchy levels SIHL already uses
 * in its back office (Management → Zone → Region → Branch → Franchisee →
 * Client) so that a user's reach in SIHL ONE means the same thing it means in
 * every other SIHL system.
 */
export const DATA_SCOPES = ['ALL', 'ZONE', 'REGION', 'BRANCH', 'TEAM', 'SELF'] as const;
export type DataScope = (typeof DATA_SCOPES)[number];

export const ORG_UNIT_TYPES = ['COMPANY', 'ZONE', 'REGION', 'BRANCH', 'TEAM'] as const;
export type OrgUnitType = (typeof ORG_UNIT_TYPES)[number];

/** Lead lifecycle. NEW → CONTACTED → QUALIFIED → CONVERTED, with two exits. */
export const LEAD_STATUSES = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'PROPOSAL',
  'CONVERTED',
  'LOST',
  'DISQUALIFIED',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/**
 * The sources the product shipped with.
 *
 * No longer the source of truth — `lead_source` in the database is, and an
 * administrator can add to it. This list survives as the **seed** for that
 * master and as the set marked `isSystem`, which cannot be deleted or re-coded
 * because scoring, assignment rules and every historical lead point at these
 * codes.
 *
 * Validation of a submitted source is now "does the master hold an active row
 * with this code", which only the API can answer. Anything typed as
 * `z.enum(LEAD_SOURCES)` before is now a plain code string.
 */
export const SYSTEM_LEAD_SOURCES = [
  'WEBSITE',
  'CAMPAIGN',
  'REFERRAL',
  'PARTNER',
  'WALK_IN',
  'INBOUND_CALL',
  'OUTBOUND_CALL',
  'SOCIAL',
  'IMPORT',
  'OTHER',
] as const;
export type SystemLeadSource = (typeof SYSTEM_LEAD_SOURCES)[number];
/** A code into the source master. Not constrained to the shipped list. */
export type LeadSource = string;

export const LEAD_LOST_REASONS = [
  'PRICE',
  'COMPETITOR',
  'NOT_INTERESTED',
  'UNREACHABLE',
  'INELIGIBLE',
  'DUPLICATE',
  'OTHER',
] as const;
export type LeadLostReason = (typeof LEAD_LOST_REASONS)[number];

export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type Priority = (typeof PRIORITIES)[number];

/** The products the product shipped with — seed for the `product` master. */
export const SYSTEM_PRODUCTS = [
  'EQUITY',
  'DERIVATIVES',
  'COMMODITY',
  'CURRENCY',
  'MUTUAL_FUNDS',
  'IPO',
  'PMS',
  'AIF',
  'INSURANCE',
  'BONDS',
  'NRI',
  'ALGO',
] as const;
export type SystemProduct = (typeof SYSTEM_PRODUCTS)[number];
/** A code into the product master. */
export type ProductInterest = string;

export const ACTIVITY_TYPES = [
  'CALL',
  'EMAIL',
  'SMS',
  'WHATSAPP',
  'MEETING',
  'VISIT',
  'NOTE',
  'STATUS_CHANGE',
  'ASSIGNMENT',
  'DOCUMENT',
  'SYSTEM',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_DIRECTIONS = ['INBOUND', 'OUTBOUND', 'INTERNAL'] as const;
export type ActivityDirection = (typeof ACTIVITY_DIRECTIONS)[number];

export const TASK_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const KYC_STATUSES = [
  'NOT_STARTED',
  'IN_PROGRESS',
  'PENDING_VERIFICATION',
  'ON_HOLD',
  'REJECTED',
  'COMPLETED',
] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

export const ONBOARDING_STAGES = [
  'LEAD',
  'KYC_STARTED',
  'PAN_VERIFIED',
  'BANK_VERIFIED',
  'ESIGN_PENDING',
  'ESIGN_DONE',
  'UNDER_REVIEW',
  'ACCOUNT_OPENED',
  'ACTIVATED',
] as const;
export type OnboardingStage = (typeof ONBOARDING_STAGES)[number];

export const CUSTOMER_STATUSES = ['PROSPECT', 'ONBOARDING', 'ACTIVE', 'DORMANT', 'CLOSED'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const PARTNER_TYPES = ['AUTHORISED_PERSON', 'REMISIER', 'REFERRAL', 'IFA', 'CORPORATE'] as const;
export type PartnerType = (typeof PARTNER_TYPES)[number];

export const PARTNER_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED'] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

export const VISIT_STATUSES = ['PLANNED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'MISSED'] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const AUDIT_ACTIONS = [
  'CREATE',
  'READ',
  'UPDATE',
  'DELETE',
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'ASSIGN',
  'EXPORT',
  'STATUS_CHANGE',
  'PERMISSION_DENIED',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Terminal lead statuses. A lead in one of these cannot be edited back into the
 * pipeline without an explicit reopen — enforced in `lead.rules.ts`.
 */
export const TERMINAL_LEAD_STATUSES: readonly LeadStatus[] = ['CONVERTED', 'LOST', 'DISQUALIFIED'];

/**
 * Allowed lead status transitions. Encoded here (not in the service) so the UI
 * can grey out impossible transitions using the exact same table the API
 * enforces — no chance of the two disagreeing.
 */
export const LEAD_STATUS_TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  NEW: ['CONTACTED', 'QUALIFIED', 'DISQUALIFIED', 'LOST'],
  CONTACTED: ['QUALIFIED', 'DISQUALIFIED', 'LOST', 'NEW'],
  QUALIFIED: ['PROPOSAL', 'CONVERTED', 'LOST', 'DISQUALIFIED'],
  PROPOSAL: ['CONVERTED', 'LOST', 'QUALIFIED'],
  CONVERTED: [],
  LOST: ['NEW'],
  DISQUALIFIED: ['NEW'],
};

export function canTransitionLead(from: LeadStatus, to: LeadStatus): boolean {
  return LEAD_STATUS_TRANSITIONS[from].includes(to);
}
