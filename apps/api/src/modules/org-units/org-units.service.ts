import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  buildPath,
  canDeleteOrgUnit,
  canParent,
  depthOf,
  explainParentRule,
  toTreeOrder,
  wouldCreateCycle,
  type CreateOrgUnitInput,
  type MoveOrgUnitInput,
  type OrgUnitNode,
  type OrgUnitType,
  type UpdateOrgUnitInput,
} from '@sihl-one/contracts';

import { AuditService } from '../../common/audit.service';
import type { AuthenticatedPrincipal } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * The organisation tree.
 *
 * Every data-scope decision resolves through this: a branch manager sees their
 * branch because their user sits at a node whose `path` prefixes the leads they
 * may read. A wrong parent here does not throw — it silently widens or narrows
 * what somebody can see, which is why moves are separated from renames, carry a
 * mandatory reason, and are audited.
 */
@Injectable()
export class OrgUnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async tree(): Promise<OrgUnitNode[]> {
    const rows = await this.prisma.orgUnit.findMany({
      include: {
        _count: {
          select: {
            users: { where: { deletedAt: null } },
            leads: { where: { deletedAt: null } },
            children: true,
          },
        },
      },
    });

    /*
      Event access is inherited, so the screen has to show two different things:
      the switch on this unit, and whether it is already on because a parent has
      it. Without the second, an administrator looking at a branch under an
      opened region sees an off switch and concludes nobody there has access.
    */
    const openedIds = new Set(
      rows.filter((row) => row.canAccessEvents).map((row) => row.id),
    );
    const inheritsEvents = (row: { id: string; path: string }): boolean =>
      row.path
        .split('/')
        .filter(Boolean)
        .some((id) => id !== row.id && openedIds.has(id));

    return toTreeOrder(
      rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        type: row.type as OrgUnitType,
        parentId: row.parentId,
        path: row.path,
        isActive: row.isActive,
        canAccessEvents: row.canAccessEvents,
        eventsInherited: inheritsEvents(row),
        depth: depthOf(row.path),
        userCount: row._count.users,
        leadCount: row._count.leads,
        childCount: row._count.children,
      })),
    );
  }

  async create(user: AuthenticatedPrincipal, input: CreateOrgUnitInput) {
    const existing = await this.prisma.orgUnit.findUnique({ where: { code: input.code } });
    if (existing) {
      throw new ConflictException({
        title: 'That code is taken',
        detail: `"${input.code}" is already used by ${existing.name}.`,
      });
    }

    let parentPath: string | null = null;
    if (input.parentId) {
      const parent = await this.prisma.orgUnit.findUnique({ where: { id: input.parentId } });
      if (!parent) throw new NotFoundException({ title: 'Parent not found' });

      if (!canParent(input.type, parent.type as OrgUnitType)) {
        throw new BadRequestException({
          title: 'Not a valid placement',
          detail: explainParentRule(input.type, parent.type as OrgUnitType),
        });
      }
      parentPath = parent.path;
    } else if (input.type !== 'COMPANY') {
      throw new BadRequestException({
        title: 'A parent is required',
        detail: `Only a company sits at the top. Choose where this ${input.type.toLowerCase()} belongs.`,
      });
    }

    // The id is needed to build the path, and the path is NOT NULL — so the row
    // is created with a placeholder and corrected in the same transaction.
    // Cheaper and safer than generating a cuid here and hoping it matches the
    // one Prisma would have produced.
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.orgUnit.create({
        data: {
          code: input.code,
          name: input.name,
          type: input.type,
          parentId: input.parentId ?? null,
          path: '/pending/',
        },
      });

      return tx.orgUnit.update({
        where: { id: row.id },
        data: { path: buildPath(parentPath, row.id) },
      });
    });

    await this.audit.record({
      action: 'CREATE',
      resource: 'org_unit',
      resourceId: created.id,
      changes: { code: created.code, name: created.name, type: created.type, path: created.path },
    });

    return created;
  }

  /** Rename or deactivate. Never re-parents — see `move`. */
  async update(user: AuthenticatedPrincipal, id: string, input: UpdateOrgUnitInput) {
    const before = await this.prisma.orgUnit.findUnique({ where: { id } });
    if (!before) throw new NotFoundException({ title: 'Unit not found' });

    if (input.isActive === false) {
      // Deactivating a unit with people in it would leave them scoped to
      // something switched off, which reads as a permissions bug to everyone
      // except the person who did it.
      const users = await this.prisma.user.count({
        where: { orgUnitId: id, deletedAt: null, status: 'ACTIVE' },
      });
      if (users > 0) {
        throw new BadRequestException({
          title: 'People are still here',
          detail: `${users} active ${users === 1 ? 'person is' : 'people are'} assigned to ${before.name}. Move them before switching it off.`,
        });
      }
    }

    const after = await this.prisma.orgUnit.update({ where: { id }, data: input });

    await this.audit.record({
      action: 'UPDATE',
      resource: 'org_unit',
      resourceId: id,
      changes: {
        ...(input.name !== undefined ? { name: { from: before.name, to: after.name } } : {}),
        ...(input.isActive !== undefined
          ? { isActive: { from: before.isActive, to: after.isActive } }
          : {}),
      },
    });

    return after;
  }

  /**
   * Re-parents a unit and rewrites its whole subtree.
   *
   * The rewrite is one UPDATE over the path prefix rather than a walk: a walk
   * would leave the tree half-moved if it failed midway, and half a tree with
   * the wrong paths is a data-visibility incident, not a retryable error.
   *
   * Paths are id-based, so nothing outside this subtree is touched, and because
   * scope resolves the path per request the change is live immediately — nobody
   * keeps visibility they have just lost until their token expires.
   */
  async move(user: AuthenticatedPrincipal, id: string, input: MoveOrgUnitInput) {
    const [unit, parent] = await Promise.all([
      this.prisma.orgUnit.findUnique({ where: { id } }),
      this.prisma.orgUnit.findUnique({ where: { id: input.parentId } }),
    ]);

    if (!unit) throw new NotFoundException({ title: 'Unit not found' });
    if (!parent) throw new NotFoundException({ title: 'New parent not found' });

    if (unit.parentId === parent.id) {
      return unit;
    }

    if (!canParent(unit.type as OrgUnitType, parent.type as OrgUnitType)) {
      throw new BadRequestException({
        title: 'Not a valid placement',
        detail: explainParentRule(unit.type as OrgUnitType, parent.type as OrgUnitType),
      });
    }

    if (wouldCreateCycle(unit.path, parent.path)) {
      throw new BadRequestException({
        title: 'That would create a loop',
        detail: `${parent.name} sits inside ${unit.name}, so ${unit.name} cannot be moved under it.`,
      });
    }

    const oldPath = unit.path;
    const newPath = buildPath(parent.path, unit.id);

    const affected = await this.prisma.$transaction(async (tx) => {
      await tx.orgUnit.update({
        where: { id },
        data: { parentId: parent.id, path: newPath },
      });

      // Every descendant, in one statement. `LIKE oldPath || '%'` uses the path
      // index, and the trailing slash in the stored format is what stops
      // `/root/ab/` from also matching `/root/abc/`.
      // The offset is computed in SQL from the old path rather than passed as a
      // number. Postgres cannot infer the type of a bind parameter in
      // `SUBSTRING(x FROM $n)`, so that form silently returns NULL and the
      // whole statement fails on the NOT NULL constraint — which is at least
      // loud, but only because the column happens to be NOT NULL.
      const rows = await tx.$executeRaw`
        UPDATE "org_unit"
        SET "path" = ${newPath}::text || SUBSTRING("path", LENGTH(${oldPath}::text) + 1)
        WHERE "path" LIKE ${`${oldPath}%`} AND "id" <> ${id}
      `;

      return rows;
    });

    await this.audit.record({
      action: 'UPDATE',
      resource: 'org_unit',
      resourceId: id,
      reason: input.reason,
      changes: {
        parentId: { from: unit.parentId, to: parent.id },
        path: { from: oldPath, to: newPath },
        descendantsRepathed: affected,
      },
    });

    return this.prisma.orgUnit.findUnique({ where: { id } });
  }

  async remove(user: AuthenticatedPrincipal, id: string): Promise<void> {
    const unit = await this.prisma.orgUnit.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            children: true,
            users: { where: { deletedAt: null } },
            leads: { where: { deletedAt: null } },
          },
        },
      },
    });
    if (!unit) throw new NotFoundException({ title: 'Unit not found' });

    const verdict = canDeleteOrgUnit({
      childCount: unit._count.children,
      userCount: unit._count.users,
      leadCount: unit._count.leads,
    });
    if (!verdict.ok) {
      throw new BadRequestException({ title: 'Cannot delete', detail: verdict.reason });
    }

    await this.prisma.orgUnit.delete({ where: { id } });

    await this.audit.record({
      action: 'DELETE',
      resource: 'org_unit',
      resourceId: id,
      changes: { code: unit.code, name: unit.name, type: unit.type },
    });
  }
}
