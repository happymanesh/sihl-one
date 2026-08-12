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
  section: 'work' | 'grow' | 'admin';
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
  { label: 'Products', href: '/products', icon: 'grid', permissions: ['lead:read'], section: 'work' },
  { label: 'Tasks', href: '/tasks', icon: 'check', permissions: ['task:read'], section: 'work' },

  { label: 'My performance', href: '/performance', icon: 'chart', permissions: ['analytics:sales:read'], section: 'work' },

  { label: 'Visits', href: '/visits', icon: 'pin', permissions: ['visit:read'], section: 'grow' },
  {
    // The partner's own portal. Gated on the partner analytics permission,
    // which only the PARTNER role holds — staff see the Partners directory
    // below instead.
    label: 'My business',
    href: '/partner',
    icon: 'handshake',
    permissions: ['analytics:partner:read'],
    section: 'work',
  },
  { label: 'Campaigns', href: '/campaigns', icon: 'megaphone', permissions: ['campaign:read'], section: 'grow' },
  { label: 'Messaging', href: '/messaging', icon: 'bell', permissions: ['campaign:read'], section: 'grow' },
  { label: 'Events', href: '/events', icon: 'pin', permissions: ['campaign:read'], section: 'grow' },
  { label: 'Partners', href: '/partners', icon: 'handshake', permissions: ['partner:read'], section: 'grow' },

  { label: 'Users', href: '/admin/users' as Route, icon: 'shield', permissions: ['user:read'], section: 'admin' },
  { label: 'Branches & regions', href: '/admin/org-units', icon: 'columns', permissions: ['system:configure'], section: 'admin' },
  { label: 'Sources & products', href: '/admin/masters', icon: 'grid', permissions: ['system:configure'], section: 'admin' },
  { label: 'Audit trail', href: '/admin/audit', icon: 'file', permissions: ['audit:read'], section: 'admin' },
];

export const SECTION_LABELS: Record<NavItem['section'], string> = {
  work: 'Work',
  grow: 'Grow',
  admin: 'Administration',
};

export function visibleNavItems(user: AuthenticatedUser): NavItem[] {
  return NAV_ITEMS.filter(
    (item) =>
      !item.permissions ||
      item.permissions.every((permission) => user.permissions.includes(permission)),
  );
}
