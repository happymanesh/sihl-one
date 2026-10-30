import type { BranchOption } from './BranchPicker';

/** Just enough of `/org-units` to build the picker. */
export interface OrgUnitNode {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
}

/**
 * The branches a training session can be held at.
 *
 * `type` decides it, not position in the tree. Leafness would be the wrong
 * test: a branch that later has a team under it stops being a leaf while
 * staying exactly the thing you want to pick, and the company root would
 * qualify in an org with one office.
 *
 * Each one carries the name of whatever it hangs off — its region, normally —
 * because the list is flat and two offices in one city read identically
 * without it.
 *
 * Shared by the create and edit screens so they cannot drift: a branch that
 * one of them offered and the other did not would silently drop off a session
 * the moment somebody edited it.
 */
export function toBranchOptions(units: OrgUnitNode[]): BranchOption[] {
  const nameById = new Map(units.map((unit) => [unit.id, unit.name]));

  return units
    .filter((unit) => unit.type === 'BRANCH')
    .map((unit) => ({
      id: unit.id,
      name: unit.name,
      region: unit.parentId ? (nameById.get(unit.parentId) ?? null) : null,
    }))
    .sort((a, b) => (a.region ?? '').localeCompare(b.region ?? '') || a.name.localeCompare(b.name));
}
