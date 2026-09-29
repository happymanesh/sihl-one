import { ROLE_PERMISSIONS, ROLES } from '@sihl-one/contracts';

import type { PrismaClient } from '../src/generated/prisma/client';

/**
 * The system roles, and their human-readable half.
 *
 * The permissions themselves live in `packages/contracts/src/rbac.ts` and are
 * not restated here — this is only what a code cannot carry: a name and a
 * sentence for the admin screen.
 */
export const ROLE_DESCRIPTIONS: Record<string, { name: string; description: string }> = {
  SUPER_ADMIN: {
    name: 'Super Administrator',
    description: 'Unrestricted access. Break-glass account.',
  },
  MANAGEMENT: {
    name: 'Management',
    description: 'Read-only visibility across the business, plus analytics.',
  },
  OPERATIONS: { name: 'Operations', description: 'Onboarding, servicing and data quality.' },
  MARKETING: { name: 'Marketing', description: 'Campaigns, lead sources and attribution.' },
  SALES_MANAGER: {
    name: 'Sales Manager',
    description: 'Owns a team; assigns and reviews their pipeline.',
  },
  SALES_EXECUTIVE: {
    name: 'Sales Executive',
    description: 'Field and desk sales. Own leads only.',
  },
  PARTNER: {
    name: 'Associate Partner',
    description: 'External partner. Own sourced business only.',
  },
  CUSTOMER: { name: 'Customer', description: 'End customer self-service.' },
};

export interface RoleSyncResult {
  code: string;
  created: boolean;
  added: string[];
  removed: string[];
}

/**
 * Writes the RBAC matrix from `contracts` into the `role` table.
 *
 * Authorisation is decided at request time from `role.permissions` in the
 * database — `PrincipalService` reads those rows, never the source file. So a
 * permission added to `rbac.ts` grants nothing anywhere until this has run, and
 * the code change looks complete while being entirely inert.
 *
 * That is not hypothetical. `event:import` was added to the matrix and shipped
 * on 28 September; on 29 September no role in either environment held it,
 * including SUPER_ADMIN, because the only thing that writes these rows is the
 * seed and the seed does not run on deploy.
 *
 * Touches nothing but `role.permissions`, `role.name` and `role.description`.
 * Not users, not role assignments, not any business data — which is what makes
 * it safe to run on every boot, unlike the full seed it was extracted from.
 *
 * Nothing in the application writes these rows, so there is no hand-tuned state
 * for this to overwrite. If a screen for editing role permissions is ever added,
 * this becomes destructive and the two have to be reconciled.
 */
export async function syncRolePermissions(prisma: PrismaClient): Promise<RoleSyncResult[]> {
  const results: RoleSyncResult[] = [];

  for (const code of ROLES) {
    const meta = ROLE_DESCRIPTIONS[code];
    if (!meta) throw new Error(`Role ${code} has no description — add it to ROLE_DESCRIPTIONS`);

    const wanted = [...ROLE_PERMISSIONS[code]];
    const existing = await prisma.role.findUnique({
      where: { code },
      select: { permissions: true },
    });

    const held = existing?.permissions ?? [];
    const added = wanted.filter((permission) => !held.includes(permission));
    // Reported as well as applied. A permission disappearing from a role is the
    // half of a matrix change that silently takes access away, and it should be
    // as visible in the deploy log as the half that grants it.
    const removed = held.filter((permission) => !wanted.includes(permission as never));

    await prisma.role.upsert({
      where: { code },
      update: { permissions: wanted, name: meta.name, description: meta.description },
      create: {
        code,
        name: meta.name,
        description: meta.description,
        permissions: wanted,
        isSystem: true,
      },
    });

    results.push({ code, created: !existing, added, removed });
  }

  return results;
}
