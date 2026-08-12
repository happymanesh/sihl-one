import { z } from 'zod';

import { codeSchema, idSchema } from './common';
import { ORG_UNIT_TYPES, type OrgUnitType } from './enums';

/**
 * The organisation tree — company, zones, regions, branches, teams.
 *
 * This is not an ordinary master. Every data-scope decision in the product
 * resolves through it: a branch manager sees their branch because their user
 * sits at a node whose `path` prefixes the leads they are allowed to read. Get
 * a parent wrong here and somebody sees another branch's book — silently, with
 * no error anywhere.
 *
 * Two things make that survivable.
 *
 * **The path is built from ids, not codes.** `/companyId/zoneId/branchId/`.
 * Renaming a branch touches nothing; only *moving* one rewrites paths, and then
 * only for that subtree.
 *
 * **The path is resolved per request, never carried in the access token.** So a
 * move takes effect on the mover's very next request rather than whenever their
 * token happens to expire — there is no window in which somebody keeps the
 * visibility they just lost.
 */

/**
 * What may sit under what.
 *
 * The chain SIHL actually uses — branch under region under zone under company —
 * with the two middle levels optional, because not every zone has regions and a
 * small business should not be forced to invent them. This is the "map branch
 * to region, region to zone" relationship, enforced rather than conventional.
 */
export const ALLOWED_PARENT_TYPES: Record<OrgUnitType, readonly OrgUnitType[]> = {
  COMPANY: [],
  ZONE: ['COMPANY'],
  REGION: ['COMPANY', 'ZONE'],
  BRANCH: ['COMPANY', 'ZONE', 'REGION'],
  TEAM: ['BRANCH'],
};

export function canParent(child: OrgUnitType, parent: OrgUnitType): boolean {
  return ALLOWED_PARENT_TYPES[child].includes(parent);
}

/** Why a placement was refused, in words an administrator can act on. */
export function explainParentRule(child: OrgUnitType, parent: OrgUnitType): string {
  const allowed = ALLOWED_PARENT_TYPES[child];
  if (allowed.length === 0) {
    return `A ${child.toLowerCase()} sits at the top and cannot be placed under anything.`;
  }
  return `A ${child.toLowerCase()} can sit under: ${allowed.map((type) => type.toLowerCase()).join(', ')}. It cannot sit under a ${parent.toLowerCase()}.`;
}

export const createOrgUnitSchema = z.object({
  code: codeSchema,
  name: z.string().trim().min(2).max(120),
  type: z.enum(ORG_UNIT_TYPES),
  /** Absent only for the company root, which already exists. */
  parentId: idSchema.optional(),
});
export type CreateOrgUnitInput = z.infer<typeof createOrgUnitSchema>;

export const updateOrgUnitSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateOrgUnitInput = z.infer<typeof updateOrgUnitSchema>;

/**
 * Moving a unit is separated from renaming it on purpose.
 *
 * A rename is cosmetic. A move silently changes who can see whose customers,
 * so it takes its own endpoint, its own confirmation and a recorded reason.
 */
export const moveOrgUnitSchema = z.object({
  parentId: idSchema,
  reason: z.string().trim().min(5, 'Record why this is moving').max(300),
});
export type MoveOrgUnitInput = z.infer<typeof moveOrgUnitSchema>;

export interface OrgUnitNode {
  id: string;
  code: string;
  name: string;
  type: OrgUnitType;
  parentId: string | null;
  path: string;
  isActive: boolean;
  /** Depth from the root, for indenting the tree. */
  depth: number;
  userCount: number;
  leadCount: number;
  childCount: number;
}

/** Ids on the path, root first. Excludes nothing — the node's own id is last. */
export function pathIds(path: string): string[] {
  return path.split('/').filter(Boolean);
}

/** `/parentPath/ownId/` — the only place this format is constructed. */
export function buildPath(parentPath: string | null, id: string): string {
  return parentPath ? `${parentPath}${id}/` : `/${id}/`;
}

export function depthOf(path: string): number {
  return Math.max(0, pathIds(path).length - 1);
}

/**
 * Whether moving `unit` under `newParent` would put it inside itself.
 *
 * The check is on the *path*, not on walking parent links: a subtree can be
 * deep, and a cycle created here would make every scope query on that branch
 * return either nothing or everything, depending on where you stood.
 */
export function wouldCreateCycle(unitPath: string, newParentPath: string): boolean {
  return newParentPath.startsWith(unitPath);
}

export interface OrgUnitUsage {
  childCount: number;
  userCount: number;
  leadCount: number;
}

/**
 * Whether a unit can be removed outright.
 *
 * Almost never. A unit with anything under it or anyone in it is deactivated
 * instead — it still has to explain the records that point at it. Deletion is
 * for a node created by mistake five minutes ago.
 */
export function canDeleteOrgUnit(usage: OrgUnitUsage): { ok: boolean; reason: string | null } {
  if (usage.childCount > 0) {
    return {
      ok: false,
      reason: `This has ${usage.childCount} ${usage.childCount === 1 ? 'unit' : 'units'} under it. Move or remove those first.`,
    };
  }
  if (usage.userCount > 0) {
    return {
      ok: false,
      reason: `${usage.userCount} ${usage.userCount === 1 ? 'person is' : 'people are'} assigned here. Move them first, or switch this off instead.`,
    };
  }
  if (usage.leadCount > 0) {
    return {
      ok: false,
      reason: `${usage.leadCount} ${usage.leadCount === 1 ? 'lead belongs' : 'leads belong'} here. Switch it off instead — the records stay readable.`,
    };
  }
  return { ok: true, reason: null };
}

/**
 * Sorts a flat list into tree order — parents immediately before their children.
 *
 * Sorting by `path` alone very nearly works and is wrong in one case: sibling
 * order would follow raw ids rather than anything a human chose. This orders
 * siblings by type then name, then walks depth-first.
 */
export function toTreeOrder(nodes: readonly OrgUnitNode[]): OrgUnitNode[] {
  const byParent = new Map<string | null, OrgUnitNode[]>();
  for (const node of nodes) {
    const siblings = byParent.get(node.parentId) ?? [];
    siblings.push(node);
    byParent.set(node.parentId, siblings);
  }

  const typeRank: Record<OrgUnitType, number> = {
    COMPANY: 0,
    ZONE: 1,
    REGION: 2,
    BRANCH: 3,
    TEAM: 4,
  };

  const ordered: OrgUnitNode[] = [];
  const walk = (parentId: string | null): void => {
    const siblings = (byParent.get(parentId) ?? []).sort(
      (a, b) => typeRank[a.type] - typeRank[b.type] || a.name.localeCompare(b.name),
    );
    for (const node of siblings) {
      ordered.push(node);
      walk(node.id);
    }
  };

  walk(null);

  // Anything unreachable from the root is appended rather than dropped. A tree
  // with an orphan is a bug worth seeing, not one worth hiding.
  if (ordered.length < nodes.length) {
    const seen = new Set(ordered.map((node) => node.id));
    ordered.push(...nodes.filter((node) => !seen.has(node.id)));
  }

  return ordered;
}
