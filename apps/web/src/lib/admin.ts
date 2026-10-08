import 'server-only';

import { ROLE_PERMISSIONS, ROLES, type AuthenticatedUser, type Role } from '@sihl-one/contracts';

import { apiFetch } from './api';

/**
 * Roles this person is allowed to hand out.
 *
 * Mirrors `canGrantRoles` on the API: you cannot grant authority you do not
 * hold yourself. Computed here so the form offers only valid options rather
 * than letting someone pick a role and receive a 403 on submit — the API check
 * remains the one that counts.
 */
export function grantableRolesFor(user: AuthenticatedUser): Role[] {
  if (user.permissions.includes('system:configure')) return [...ROLES];

  const held = new Set(user.permissions);
  return ROLES.filter((role) => ROLE_PERMISSIONS[role].every((permission) => held.has(permission)));
}

/**
 * Branches for the picker.
 *
 * There is no dedicated org-unit endpoint yet, so this derives the list from
 * the users the caller can already see — which has the useful side effect of
 * naturally limiting it to their own part of the organisation. Replace with a
 * proper `/admin/org-units` endpoint when the org chart gets its own screen.
 */
export async function orgUnitOptions(): Promise<Array<{ id: string; label: string }>> {
  /*
    Read from the org tree, not from the people in it.

    This used to collect the distinct branches off `/admin/users`, which meant a
    branch nobody had been posted to yet did not exist as far as the form was
    concerned — so the first person at a new branch could not be assigned to it,
    which is exactly when you need to.

    Indented by depth so the tree reads as a tree in a flat select.
  */
  const units = await apiFetch<
    Array<{ id: string; name: string; path: string; isActive: boolean }>
  >('/org-units').catch(() => []);

  return units
    .filter((unit) => unit.isActive)
    .map((unit) => ({
      id: unit.id,
      name: unit.name,
      depth: Math.max(0, unit.path.split('/').filter(Boolean).length - 1),
    }))
    .sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name))
    .map((unit) => ({ id: unit.id, label: `${' '.repeat(unit.depth * 2)}${unit.name}` }));
}
