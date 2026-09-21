import type { PrismaService } from '../prisma/prisma.service';

/**
 * May this person see events and their own registration QR?
 *
 * Two switches, ANDed: the hierarchy level (`Designation.canAccessEvents`) and
 * the branch (`OrgUnit.canAccessEvents`). Neither alone grants anything.
 *
 * The branch switch applies to the unit it is set on **and everything beneath
 * it**, so a region can be opened once rather than branch by branch. That is
 * why the check walks the materialised path rather than looking at the user's
 * own unit: the switch is far more likely to be set on the region than on each
 * office under it, and a check that only looked at the leaf would silently do
 * nothing in exactly the case the feature was asked for.
 *
 * Used when resolving somebody *other* than the caller — a rep named by an
 * employee code on a public capture link. The caller's own access is decided in
 * `PrincipalService`, which already holds the designation and the org path and
 * so answers the same question without these two queries.
 */
export async function hasEventAccess(
  prisma: PrismaService,
  user: { designationId?: string | null; orgUnitId?: string | null },
): Promise<boolean> {
  if (!user.designationId || !user.orgUnitId) return false;

  const designation = await prisma.designation.findUnique({
    where: { id: user.designationId },
    select: { canAccessEvents: true, isActive: true },
  });
  if (!designation?.isActive || !designation.canAccessEvents) return false;

  const orgUnit = await prisma.orgUnit.findUnique({
    where: { id: user.orgUnitId },
    select: { path: true },
  });
  if (!orgUnit) return false;

  // The path is /id/id/id/, outermost first, ending in this unit. Every id in
  // it is this unit or one of its ancestors, so one `in` query answers the
  // whole chain without recursing.
  const chain = orgUnit.path.split('/').filter(Boolean);
  if (chain.length === 0) return false;

  const opened = await prisma.orgUnit.count({
    where: { id: { in: chain }, canAccessEvents: true, isActive: true },
  });
  return opened > 0;
}
