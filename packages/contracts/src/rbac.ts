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
  /*
    Permanent, irreversible destruction of a lead and everything hanging off it.

    Deliberately not `lead:delete`, which every operations user holds and which
    only sets `deletedAt` — a soft delete the record survives and can be undone
    from. This one leaves nothing behind but the audit row, so it is its own
    grant, held by super admin alone through ALL_PERMISSIONS and named in no
    other role's list.

    It exists for the two cases a soft delete cannot answer: an erasure the
    DPDP Act obliges SIHL to carry out, and test or junk data that must not sit
    in a regulated book for ever. Both are rare and both are decisions somebody
    has to be accountable for, which is why the endpoint demands the lead
    number typed back and a written reason, and why the audit row records a
    count of every table it emptied.
  */
  'lead:purge',

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
  /*
    Filing a batch of registrations against an event.

    Held by the back office — super admin, operations and management — and by
    nobody in sales. Attributing rows to an event moves the numbers that event
    is judged on, so it is a controlled act rather than something any rep can do
    with a spreadsheet.

    It is not the only way in. The owner of an event may always upload for that
    event, whoever they are, which is how a stall's own rep files the notebook
    they filled in: they are made the owner of the event they are working. That
    check lives in `ImportsService.resolveEventContext`, because it is a
    question about one event rather than about a role.

    Either way the file is confined — an event the uploader can see, inside the
    window after it, every row landing on that event. Bringing an arbitrary list
    into SIHL is `lead:import`, and carries its own declaration.
  */
  'event:import',
  /*
    Creating an event.

    Split out from `campaign:create`, which it had been riding on. They are not
    the same act: a campaign is a marketing spend, an event is a stall with a QR
    code whose owner then decides who may upload for it and who sees what it
    brings in. Held by super admin and management only, on instruction.
  */
  'event:create',

  // Analytics
  'analytics:sales:read',
  'analytics:marketing:read',
  'analytics:partner:read',
  'analytics:management:read',
  /*
    The MIS Summary workbook.

    Its own grant rather than riding on `analytics:sales:read`, which every
    sales role holds. This workbook names every person in the caller's scope,
    their mobile number and their whole book position in one file — a
    back-office report, not something a desk should be able to pull about
    their colleagues.
  */
  'report:mis',
  /*
    Emailing a performance report out of the system.

    Split off `analytics:sales:read`, which it used to sit on. Reading a
    dashboard and mailing a judgement of named colleagues' work to their
    inboxes are not the same authority, and that read is held by five roles
    including every sales executive — so a route that sends mail in SIHL's
    name was reachable by nearly anybody who could log in.

    Granted to the roles whose job this is: management, operations, and a sales
    manager reporting on their own team. Not marketing, who hold the read for
    attribution and have no business mailing staff appraisals, and not a sales
    executive, who is one of the people the report is about.
  */
  'report:send',

  /*
    Templated outbound messaging.

    Its own grant rather than `campaign:read` / `campaign:create`, which
    Management and Marketing also hold. This sends messages to clients in
    SIHL's name, under consent, DND and quiet-hours rules — a narrower act
    than reading a campaign, and held by super admin alone on instruction.

    The send route in particular sat on `activity:create`, which nearly every
    role holds, so restricting the menu alone would have left it reachable by
    anybody who knew the URL.
  */
  'messaging:manage',
  /*
    Seeing the Performance screen.

    Split from `analytics:sales:read`, which also opens Reports and the
    Dashboard and is held by Management, Operations, Marketing, sales managers
    and executives. Tightening that one would have taken all three screens
    from all five roles, so Performance needed a grant of its own.

    Held by super admin alone, through ALL_PERMISSIONS, and deliberately not
    listed against any other role. This is a holding position rather than a
    judgement about rank: the screen measures people against targets and
    incentives the system does not yet hold, so it is withdrawn until it has
    something real to measure. CR-15 — which scopes a rep to their own row —
    stays exactly as it is, and is what will make the screen safe to reopen.

    Granted on the read routes *and* on `report/send`. That route mails the
    report out in SIHL's name and sits on `report:send`, which Management,
    Operations and sales managers hold; leaving it alone would have let the
    three roles that just lost the screen go on posting its contents to
    people's inboxes.
  */
  'performance:read',
  /*
    The CEO's MIS.

    Its own grant, and not folded into `performance:read`: that one withdrew a
    screen until it has targets to measure against, while this one is the view
    of the firm from the top and is wanted now. Tying them would mean reviving
    Performance in order to give somebody the MIS.

    Held by super admin through ALL_PERMISSIONS, and granted to nobody else by
    name. The report reads the whole firm by design — it is not scoped, because
    a CEO report that showed a subtree would be answering a different question
    — so the permission is the only thing standing in front of it.
  */
  'mis:read',
  /*
    Seeing the partner portal.

    Split from `analytics:partner:read`, which Management also holds — so
    Management saw a "My business" menu entry that could only ever bounce
    them to the Dashboard, because the page requires the PARTNER role. The
    menu said one thing and the page another.

    Granted to PARTNER, whose portal it is, and to super admin through
    ALL_PERMISSIONS, who uses it to see what a given partner sees. Nobody
    else.
  */
  'partner:portal',

  // Training & Test
  //
  // Reading training needs no permission at all: a session is announced to the
  // branches it is for, and hiding it from the people expected to attend would
  // defeat the point. Only scheduling and editing are gated.
  'training:manage',
  /*
    Writing questions, and putting a test live.

    Deliberately not `training:manage`. Scheduling a branch session and
    setting the exam that decides whether a rep may sell a product are
    different kinds of authority: the first is a diary entry, the second
    produces a pass/fail record SIHL may have to defend to a regulator.
    Splitting them costs one line now and is awkward to unpick later.
  */
  'test:manage',

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
    /*
      Adding a lead by hand, and Insta Lead.

      Both roles could import a spreadsheet of thousands and not type in a
      single walk-in, which is the wrong way round: an import is the bulk,
      riskier act and it was the only one they had.

      The visit grants come with Insta Lead rather than on their own merit.
      It captures someone in person and checks straight into the meeting, so
      without `visit:create` the button cannot work, and without read and
      update the user is left inside a visit they cannot see or close.
    */
    'lead:create',
    'visit:create',
    'visit:update',
    'training:manage',
    'test:manage',
    'report:mis',
    'report:send',
    'lead:read',
    'lead:export',
    'lead:import',
    'event:import',
    'event:create',
    // Needed to name an event's owner and pick its branch — both selects read
    // the user list and the org tree, and neither was reachable without this.
    'user:read',
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
    /*
      Adding a lead by hand, and Insta Lead.

      Both roles could import a spreadsheet of thousands and not type in a
      single walk-in, which is the wrong way round: an import is the bulk,
      riskier act and it was the only one they had.

      The visit grants come with Insta Lead rather than on their own merit.
      It captures someone in person and checks straight into the meeting, so
      without `visit:create` the button cannot work, and without read and
      update the user is left inside a visit they cannot see or close.
    */
    'lead:create',
    'visit:create',
    'visit:read',
    'visit:update',
    'training:manage',
    'test:manage',
    'report:mis',
    'report:send',
    'lead:read',
    'lead:update',
    'lead:import',
    'lead:export',
    'event:import',
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
    'user:read',
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
    // Their own team's performance report, to their own team. The screen that
    // sends it is a manager's screen; the report is addressed to the people in
    // it, and every recipient has to resolve to an active SIHL user.
    'report:send',
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
    // Read-only directory. Without manage rights the list is scoped to their
    // reporting line, which for a rep is themselves alone.
    'user:read',
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
    /*
      Reps import and export their own book.

      Granted on the product owner's instruction: a rep with a list of contacts
      should not have to queue behind whoever holds the permission, and the
      export is how they work their own leads in a spreadsheet on the road.

      What they cannot do is choose where the leads land. Their scope is SELF,
      so `assignableUserScope` offers them only themselves and everything they
      import is theirs. `event:import` stays alongside this rather than being
      made redundant by it — it is the narrower grant, and the five-day window
      still binds any file attributed to an event whoever uploads it.
    */
    'lead:import',
    'lead:export',
    'analytics:sales:read',
  ],

  PARTNER: [
    'lead:read',
    'lead:create',
    // A partner brings their own book and works it in a spreadsheet. Both are
    // confined to their firm: `assignableUserScope` matches on `partnerId`, so
    // they can hand a lead to their own staff and to nobody at SIHL.
    'lead:import',
    'lead:export',
    'customer:read',
    'activity:read',
    'activity:create',
    'partner:payout:read',
    'analytics:partner:read',
    'partner:portal',
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
/**
 * Applies the per-user "may assign leads to other people" switch.
 *
 * The switch is the whole answer to who may hand work to somebody else,
 * whatever role that person holds — so it both grants `lead:assign` and takes
 * it away. See the note in `PrincipalService` for why it works that way.
 *
 * It lives here because two places compute a person's permissions: the guard
 * on every request, and the payload the sign-in and `/auth/me` return for the
 * UI to read. They disagreed, which is the worst shape this can take — the API
 * allowed an assign the screen had already hidden the button for.
 */
export function withLeadAssignSwitch(
  permissions: readonly Permission[],
  canAssignLeads: boolean | null | undefined,
): Permission[] {
  // Annotated, because the filter predicate narrows the element type to
  // "every permission except lead:assign" and the push below would not fit it.
  const out: Permission[] = permissions.filter((permission) => permission !== 'lead:assign');
  if (canAssignLeads !== false) out.push('lead:assign');
  return out;
}

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
