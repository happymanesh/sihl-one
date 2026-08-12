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
  return ROLES.filter((role) =>
    ROLE_PERMISSIONS[role].every((permission) => held.has(permission)),
  );
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
  const users = await apiFetch<Array<{ orgUnit: { id: string; name: string } | null }>>(
    '/admin/users',
  ).catch(() => []);

  const seen = new Map<string, string>();
  for (const user of users) {
    if (user.orgUnit) seen.set(user.orgUnit.id, user.orgUnit.name);
  }

  return [...seen.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
