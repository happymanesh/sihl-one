import { DATA_SCOPES, type DataScope, type Role } from './enums';

/**
 * Permission catalogue.
 *
 * Format is `<resource>:<action>`. Permissions — never roles — are what guards
 * check. Roles are a bundling convenience that the business can re-cut without
 * a code change; if a guard said `@Roles('SALES_MANAGER')` then every future
 * org redesign would be a code change instead of a config change.
 */
export const PERMISSIONS = [
  // CRM — leads
  'lead:read',
  'lead:create',
  'lead:update',
  'lead:delete',
  'lead:assign',
  'lead:convert',
  'lead:export',
  'lead:import',

  // CRM — customers
  'customer:read',
  'customer:create',
  'customer:update',
  'customer:export',

  // Activities, tasks, notes
  'activity:read',
  'activity:create',
  'task:read',
  'task:create',
  'task:update',

  // Field sales
  'visit:read',
  'visit:create',
  'visit:update',

  // Partner
  'partner:read',
  'partner:create',
  'partner:update',
  'partner:payout:read',

  // Marketing
  'campaign:read',
  'campaign:create',
  'campaign:update',

  /*
    Seeing events, separate from running them.

    `campaign:read` is a marketing grant: campaigns, spend, attribution. A rep
    standing at a stall needs none of that — they need the event list and their
    own QR. Splitting the two is what lets a sales executive be given the second
    without the first, which is the whole point of the branch-level switch.

    Granted statically to the roles that already held `campaign:read`, so this
    change takes nothing away from anyone, and granted per request in
    `PrincipalService` to anyone whose hierarchy level and branch are both
    switched on — which is what makes the switch take effect immediately.
  */
  'event:view',

  // Analytics
  'analytics:sales:read',
  'analytics:marketing:read',
  'analytics:partner:read',
  'analytics:management:read',

  // Administration
  'user:read',
  'user:create',
  'user:update',
  'role:manage',
  'audit:read',
  'system:configure',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL_PERMISSIONS = PERMISSIONS as readonly Permission[];

/**
 * Role → permission matrix.
 *
 * Kept small and explicit on purpose. Anything a role should not be able to do
 * is simply absent — there are no negative/deny permissions, because deny rules
 * interacting with inheritance is the classic source of "why can this person
 * see that" incidents.
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: ALL_PERMISSIONS,

  MANAGEMENT: [
    'lead:read',
    'lead:export',
    'customer:read',
    'customer:export',
    'activity:read',
    'task:read',
    'visit:read',
    'partner:read',
    'partner:payout:read',
    'campaign:read',
    'event:view',
    'analytics:sales:read',
    'analytics:marketing:read',
    'analytics:partner:read',
    'analytics:management:read',
    'audit:read',
  ],

  OPERATIONS: [
    'lead:read',
    'lead:update',
    'lead:import',
    'customer:read',
    'customer:create',
    'customer:update',
    'activity:read',
    'activity:create',
    'task:read',
    'task:create',
    'task:update',
    'partner:read',
    'partner:update',
    'analytics:sales:read',
    'user:read',
  ],

  MARKETING: [
    'lead:read',
    'lead:create',
    'lead:import',
    'lead:export',
    'customer:read',
    'campaign:read',
    'campaign:create',
    'campaign:update',
    'event:view',
    'analytics:marketing:read',
    'analytics:sales:read',
  ],

  SALES_MANAGER: [
    'lead:read',
    'lead:create',
    'lead:update',
    'lead:assign',
    'lead:convert',
    'lead:export',
    // A new joiner arriving with a spreadsheet is onboarded by their sales
    // manager, not by marketing. Withholding this forced the import through
    // whoever happened to hold a marketing role, which is both inconvenient
    // and wrong for provenance — the declaration should be made by the person
    // who actually knows where the data came from.
    'lead:import',
    'customer:read',
    'customer:update',
    'activity:read',
    'activity:create',
    'task:read',
    'task:create',
    'task:update',
    'visit:read',
    'visit:create',
    'visit:update',
    'partner:read',
    'analytics:sales:read',
    'user:read',
    // Onboard their own team. Safe only because UserAdminService enforces the
    // three escalation guards: below their level, inside their subtree, and no
    // permission they do not already hold themselves.
    'user:create',
  ],

  SALES_EXECUTIVE: [
    'lead:read',
    'lead:create',
    'lead:update',
    'lead:convert',
    'customer:read',
    'customer:update',
    'activity:read',
    'activity:create',
    'task:read',
    'task:create',
    'task:update',
    'visit:read',
    'visit:create',
    'visit:update',
    'analytics:sales:read',
  ],

  PARTNER: [
    'lead:read',
    'lead:create',
    'customer:read',
    'activity:read',
    'activity:create',
    'partner:payout:read',
    'analytics:partner:read',
  ],

  CUSTOMER: ['customer:read', 'activity:read', 'task:read'],
};

/**
 * Default data scope per role. A user record may narrow this further, but never
 * widen it — `effectiveScope()` enforces that.
 */
export const ROLE_DEFAULT_SCOPE: Record<Role, DataScope> = {
  SUPER_ADMIN: 'ALL',
  MANAGEMENT: 'ALL',
  OPERATIONS: 'ALL',
  MARKETING: 'ALL',
  SALES_MANAGER: 'TEAM',
  SALES_EXECUTIVE: 'SELF',
  PARTNER: 'SELF',
  CUSTOMER: 'SELF',
};

/** Broadest (index 0) to narrowest. Used to compare two scopes. */
const SCOPE_BREADTH: readonly DataScope[] = DATA_SCOPES;

export function isScopeBroaderThan(a: DataScope, b: DataScope): boolean {
  return SCOPE_BREADTH.indexOf(a) < SCOPE_BREADTH.indexOf(b);
}

/**
 * A user's real scope is the narrower of what their role grants and what their
 * own record requests. Widening via the user record is silently ignored rather
 * than rejected, so a mis-keyed admin edit degrades to less access, not more.
 */
export function effectiveScope(roles: readonly Role[], requested?: DataScope | null): DataScope {
  const broadestFromRoles = roles.reduce<DataScope>((widest, role) => {
    const roleScope = ROLE_DEFAULT_SCOPE[role];
    return isScopeBroaderThan(roleScope, widest) ? roleScope : widest;
  }, 'SELF');

  if (!requested) return broadestFromRoles;
  return isScopeBroaderThan(requested, broadestFromRoles) ? broadestFromRoles : requested;
}

/** Union of every permission granted by the supplied roles. */
export function permissionsForRoles(roles: readonly Role[]): Permission[] {
  const set = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) set.add(permission);
  }
  return [...set];
}

export function hasPermission(granted: readonly Permission[], required: Permission): boolean {
  return granted.includes(required);
}

export function hasAllPermissions(
  granted: readonly Permission[],
  required: readonly Permission[],
): boolean {
  return required.every((permission) => granted.includes(permission));
}
