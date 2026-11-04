import type { Route } from 'next';
import type { AuthenticatedUser, Permission } from '@sihl-one/contracts';

export interface NavItem {
  label: string;
  /** Typed against the real route tree, so a renamed page breaks the build. */
  href: Route;
  icon: string;
  /** Item is shown only if the user holds every permission listed. */
  permissions?: Permission[];
  /**
   * False for destinations that do not exist yet. They still render — a
   * shipped-looking menu that silently omits half the product is its own kind
   * of dishonesty — but as a disabled item marked "Soon" rather than a link
   * that 404s. A dead menu item is worse than an absent one.
   */
  available?: boolean;
  section: 'work' | 'grow' | 'learn' | 'admin';
}

/**
 * Navigation is derived from permissions, not from roles.
 *
 * A role-keyed menu has to be edited every time the business invents a role,
 * and it drifts from what the API will actually allow. Deriving from the same
 * permission strings the guards check means a user never sees a menu item that
 * leads to a 403.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    // Gated, despite being everyone's default landing page for staff. A partner
    // holds none of the sales analytics permissions the staff dashboard reads,
    // so an ungated entry sent them to a guaranteed 403 — their home is the
    // partner portal below.
    label: 'Dashboard',
    href: '/dashboard',
    icon: 'grid',
    permissions: ['analytics:sales:read'],
    section: 'work',
  },
  { label: 'Leads', href: '/leads', icon: 'target', permissions: ['lead:read'], section: 'work' },
  { label: 'Pipeline', href: '/pipeline', icon: 'columns', permissions: ['lead:read'], section: 'work' },
  { label: 'Duplicates', href: '/leads/duplicates', icon: 'search', permissions: ['lead:update'], section: 'work' },
  { label: 'Customers', href: '/customers', icon: 'users', permissions: ['customer:read'], section: 'work' },
  { label: 'Tasks', href: '/tasks', icon: 'check', permissions: ['task:read'], section: 'work' },
  // Directly under Tasks, and in Work rather than Grow: a field visit is a
  // rep's daily work alongside their task list, not a growth activity like a
  // campaign. It sat under a separate heading further down the menu, which is
  // not where anyone looked for it.
  { label: 'Visits', href: '/visits', icon: 'pin', permissions: ['visit:read'], section: 'work' },

  // Super admin only, until targets and incentives exist. See CR-27 and the
  // note on `performance:read` — the page and the API enforce it too, because
  // a menu that hides a link is presentation, not access control.
  { label: 'Performance', href: '/performance', icon: 'chart', permissions: ['performance:read'], section: 'work' },

  // Same permission as the dashboard, because the separation here is by data
  // scope rather than by rank: a rep opens this and sees one row — their own.
  { label: 'Reports', href: '/reports' as Route, icon: 'file', permissions: ['analytics:sales:read'], section: 'work' },
  // Sits beside the period report rather than inside it: they answer different
  // questions. That one judges a month, this one asks who needs help today.
  { label: 'Daily activity', href: '/reports/daily' as Route, icon: 'chart', permissions: ['analytics:sales:read'], section: 'work' },

  {
    // The partner's own portal, and super admin's window onto it.
    //
    // Gated on `partner:portal` rather than the partner analytics grant,
    // which Management also holds: they saw this entry and the page bounced
    // them straight back to the Dashboard, which is why it looked like a
    // duplicate of it.
    label: 'My business',
    href: '/partner',
    icon: 'handshake',
    permissions: ['partner:portal'],
    section: 'work',
  },
  // Below My business, on the business's instruction. It is reference
  // material rather than a worklist — what a rep opens to check a charge
  // or an eligibility rule mid-call — so it reads better at the end of
  // Work than above the screens they live in all day.
  { label: 'Products', href: '/products', icon: 'grid', permissions: ['lead:read'], section: 'work' },
  { label: 'Campaigns', href: '/campaigns', icon: 'megaphone', permissions: ['campaign:read'], section: 'grow' },
  { label: 'Messaging', href: '/messaging', icon: 'bell', permissions: ['messaging:manage'], section: 'grow' },
  /*
    No permission listed, deliberately.

    Events is shown to everybody so that the option is discoverable — a rep who
    cannot see it has no way to know it exists, and no reason to ask their
    manager to switch it on. The page itself still enforces access and explains
    what is missing, so the item is informative rather than a dead end.
  */
  { label: 'Events', href: '/events', icon: 'pin', section: 'grow' },
  { label: 'Partners', href: '/partners', icon: 'handshake', permissions: ['partner:read'], section: 'grow' },

  { label: 'Users', href: '/admin/users' as Route, icon: 'shield', permissions: ['user:read'], section: 'admin' },
  { label: 'Branches & regions', href: '/admin/org-units', icon: 'columns', permissions: ['system:configure'], section: 'admin' },
  /*
    Its own section rather than loose in Grow.

    Training and Test are independent of each other — a branch runs training
    nobody is examined on, and sets exams on material nobody was trained for —
    but they are one thing to the person looking for them, and Grow is about
    winning business rather than developing staff.

    Training has no permission: a session is announced to the branches it is
    for, and hiding it from the people expected to attend would defeat it.
    Scheduling is gated by `training:manage` on the API.
  */
  { label: 'Training', href: '/training', icon: 'users', section: 'learn' },
  /*
    The bank is gated where training is not, and for the opposite reason: a
    question carries its own answer, so an open bank is an open answer key.
  */
  { label: 'Question bank', href: '/test/questions', icon: 'file', permissions: ['test:manage'], section: 'learn' },
  { label: 'Test', href: '/test', icon: 'check', section: 'learn' },

  { label: 'Sources & products', href: '/admin/masters', icon: 'grid', permissions: ['system:configure'], section: 'admin' },
  { label: 'Audit trail', href: '/admin/audit', icon: 'file', permissions: ['audit:read'], section: 'admin' },
  /*
    Last in the list on purpose, and gated on a permission only super admin
    holds, so for everybody else this entry does not exist. The page behind it
    destroys a lead permanently; it is reachable from the menu rather than
    from a lead precisely so that getting there is a decision rather than a
    stray click next to Transfer.
  */
  { label: 'Purge a lead', href: '/admin/lead-purge' as Route, icon: 'trash', permissions: ['lead:purge'], section: 'admin' },
];

export const SECTION_LABELS: Record<NavItem['section'], string> = {
  work: 'Work',
  grow: 'Grow',
  learn: 'Training & Test',
  admin: 'Administration',
};

export function visibleNavItems(user: AuthenticatedUser): NavItem[] {
  return NAV_ITEMS.filter(
    (item) =>
      !item.permissions ||
      item.permissions.every((permission) => user.permissions.includes(permission)),
  );
}
