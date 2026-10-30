import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  canEditTraining,
  hasFinished,
  type CreateTrainingInput,
  type TrainingQuery,
  type TrainingStatus,
  type TrainingView,
  type UpdateTrainingInput,
} from '@sihl-one/contracts';

import { AuditService } from '../../common/audit.service';
import { StorageService } from '../storage/storage.service';
import type { AuthenticatedPrincipal } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Training sessions.
 *
 * The rule that shapes everything here is that a session stops being a plan
 * once it has run. Until then it is editable; afterwards it is a record of
 * something that happened, and a record you can still edit is not a record.
 *
 * That cut-off is `hasFinished` from the contracts, shared with the event
 * presentation slot, so both read the same sentence the same way — and the
 * screen asks the same function the server does rather than approximating it.
 */
@Injectable()
export class TrainingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  private view(row: {
    id: string;
    topic: string;
    startsAt: Date;
    durationMinutes: number;
    presenterName: string | null;
    presenterId: string | null;
    remarks: string | null;
    status: string;
    createdAt: Date;
    createdBy: { firstName: string; lastName: string };
    presenter: { firstName: string; lastName: string } | null;
    branches: Array<{ orgUnit: { id: string; name: string } }>;
    material: Array<{
      id: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      createdAt: Date;
      uploadedBy: { firstName: string; lastName: string };
    }>;
  }): TrainingView {
    const status = row.status as TrainingStatus;
    return {
      id: row.id,
      topic: row.topic,
      startsAt: row.startsAt.toISOString(),
      durationMinutes: row.durationMinutes,
      endsAt: new Date(row.startsAt.getTime() + row.durationMinutes * 60_000).toISOString(),
      // The staff presenter's name wins when there is one: it stays correct if
      // they are renamed, where a typed copy would not.
      presenterName: row.presenter
        ? `${row.presenter.firstName} ${row.presenter.lastName}`.trim()
        : row.presenterName,
      presenterId: row.presenterId,
      remarks: row.remarks,
      status,
      branches: row.branches.map((link) => link.orgUnit),
      material: row.material.map((file) => ({
        id: file.id,
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        uploadedBy: `${file.uploadedBy.firstName} ${file.uploadedBy.lastName}`.trim(),
        createdAt: file.createdAt.toISOString(),
      })),
      createdBy: `${row.createdBy.firstName} ${row.createdBy.lastName}`.trim(),
      createdAt: row.createdAt.toISOString(),
      editable: canEditTraining(
        {
          startsAt: row.startsAt.toISOString(),
          durationMinutes: row.durationMinutes,
          status,
        },
        new Date(),
      ),
    };
  }

  private readonly include = {
    createdBy: { select: { firstName: true, lastName: true } },
    presenter: { select: { firstName: true, lastName: true } },
    branches: { include: { orgUnit: { select: { id: true, name: true } } } },
    material: {
      orderBy: { createdAt: 'asc' as const },
      include: { uploadedBy: { select: { firstName: true, lastName: true } } },
    },
  };

  async list(query: TrainingQuery): Promise<TrainingView[]> {
    const now = new Date();

    /*
      Upcoming by default, because the list is used to plan rather than to
      browse history — and "upcoming" means not yet finished, not "starts
      later". A session running right now is the one most likely to be opened.
    */
    const timing =
      query.scope === 'UPCOMING'
        ? { startsAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) } }
        : query.scope === 'PAST'
          ? { startsAt: { lt: now } }
          : {};

    const rows = await this.prisma.training.findMany({
      where: {
        ...timing,
        ...(query.branchId ? { branches: { some: { orgUnitId: query.branchId } } } : {}),
        ...(query.q
          ? {
              OR: [
                { topic: { contains: query.q, mode: 'insensitive' as const } },
                { presenterName: { contains: query.q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      include: this.include,
      orderBy: query.scope === 'PAST' ? { startsAt: 'desc' } : { startsAt: 'asc' },
      take: 200,
    });

    return rows.map((row) => this.view(row));
  }

  async findOne(id: string): Promise<TrainingView> {
    const row = await this.prisma.training.findUnique({ where: { id }, include: this.include });
    if (!row) throw new NotFoundException({ title: 'Training not found' });
    return this.view(row);
  }

  async create(user: AuthenticatedPrincipal, input: CreateTrainingInput): Promise<TrainingView> {
    await this.assertBranchesExist(input.branchIds);

    const created = await this.prisma.training.create({
      data: {
        topic: input.topic,
        startsAt: new Date(input.startsAt),
        durationMinutes: input.durationMinutes,
        presenterName: input.presenterName ?? null,
        presenterId: input.presenterId ?? null,
        remarks: input.remarks ?? null,
        createdById: user.id,
        branches: { create: input.branchIds.map((orgUnitId) => ({ orgUnitId })) },
      },
      include: this.include,
    });

    await this.audit.record({
      action: 'CREATE',
      resource: 'training',
      resourceId: created.id,
      changes: {
        topic: created.topic,
        startsAt: created.startsAt,
        branches: input.branchIds.length,
      },
    });

    return this.view(created);
  }

  async update(
    user: AuthenticatedPrincipal,
    id: string,
    input: UpdateTrainingInput,
  ): Promise<TrainingView> {
    const existing = await this.mustBeEditable(id);

    if (input.branchIds) await this.assertBranchesExist(input.branchIds);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (input.branchIds) {
        // Replaced wholesale rather than diffed: the form posts the complete
        // list, so anything missing from it was deliberately removed.
        await tx.trainingBranch.deleteMany({ where: { trainingId: id } });
        await tx.trainingBranch.createMany({
          data: input.branchIds.map((orgUnitId) => ({ trainingId: id, orgUnitId })),
        });
      }

      return tx.training.update({
        where: { id },
        data: {
          ...(input.topic !== undefined ? { topic: input.topic } : {}),
          ...(input.startsAt !== undefined ? { startsAt: new Date(input.startsAt) } : {}),
          ...(input.durationMinutes !== undefined
            ? { durationMinutes: input.durationMinutes }
            : {}),
          ...(input.presenterName !== undefined
            ? { presenterName: input.presenterName || null }
            : {}),
          ...(input.presenterId !== undefined ? { presenterId: input.presenterId || null } : {}),
          ...(input.remarks !== undefined ? { remarks: input.remarks || null } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
        include: this.include,
      });
    });

    await this.audit.record({
      action: 'UPDATE',
      resource: 'training',
      resourceId: id,
      changes: {
        ...(input.topic !== undefined ? { topic: { from: existing.topic, to: input.topic } } : {}),
        ...(input.startsAt !== undefined
          ? { startsAt: { from: existing.startsAt, to: input.startsAt } }
          : {}),
        ...(input.status !== undefined
          ? { status: { from: existing.status, to: input.status } }
          : {}),
      },
    });

    return this.view(updated);
  }

  /**
   * Remove a session that has not run.
   *
   * Hard delete, and only before it finishes — which is the whole of what
   * makes it safe. Nothing has attended it, nothing reports on it, and the
   * material goes with it. After it has run there is nothing to delete: the
   * route refuses, and cancelling is the way to say it did not happen.
   */
  async remove(user: AuthenticatedPrincipal, id: string): Promise<void> {
    const existing = await this.mustBeEditable(id);

    const material = await this.prisma.trainingMaterial.findMany({
      where: { trainingId: id },
      select: { storageKey: true },
    });

    await this.prisma.training.delete({ where: { id } });

    // After the row is gone, so a storage failure cannot leave a training
    // pointing at material that is no longer there.
    for (const file of material) {
      await this.storage.remove(file.storageKey).catch(() => undefined);
    }

    await this.audit.record({
      action: 'DELETE',
      resource: 'training',
      resourceId: id,
      changes: { topic: existing.topic, startsAt: existing.startsAt, files: material.length },
    });
  }

  async addMaterial(
    user: AuthenticatedPrincipal,
    id: string,
    file: { fileName: string; mimeType: string; sizeBytes: number; storageKey: string },
  ): Promise<TrainingView> {
    await this.mustBeEditable(id);

    await this.prisma.trainingMaterial.create({
      data: {
        trainingId: id,
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        storageKey: file.storageKey,
        uploadedById: user.id,
      },
    });

    await this.audit.record({
      action: 'CREATE',
      resource: 'training.material',
      resourceId: id,
      changes: { fileName: file.fileName, sizeBytes: file.sizeBytes },
    });

    return this.findOne(id);
  }

  /** The stored key for a file, once the caller has been allowed to read it. */
  async materialKey(
    trainingId: string,
    materialId: string,
  ): Promise<{ key: string; name: string }> {
    const file = await this.prisma.trainingMaterial.findFirst({
      where: { id: materialId, trainingId },
      select: { storageKey: true, fileName: true },
    });
    if (!file) throw new NotFoundException({ title: 'File not found' });
    return { key: file.storageKey, name: file.fileName };
  }

  /**
   * The session, if it can still be changed.
   *
   * One place, so every write path answers the question identically. A route
   * that forgot to ask would otherwise let somebody edit last month's session
   * and quietly rewrite what was presented.
   */
  private async mustBeEditable(id: string) {
    const row = await this.prisma.training.findUnique({ where: { id } });
    if (!row) throw new NotFoundException({ title: 'Training not found' });

    if (row.status === 'CANCELLED') {
      throw new BadRequestException({
        title: 'This session was cancelled',
        detail: 'A cancelled session is kept as a record and cannot be changed.',
      });
    }

    if (hasFinished(row.startsAt, row.durationMinutes, new Date())) {
      const ended = new Date(row.startsAt.getTime() + row.durationMinutes * 60_000);
      throw new BadRequestException({
        title: 'This session has finished',
        detail: `It ended at ${ended.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} and is now read-only.`,
      });
    }

    return row;
  }

  /**
   * Every id must be a live branch.
   *
   * `type` is checked here and not only in the dropdown, because the rule is
   * about what a session can be held at rather than about what a screen
   * offers. A zone or a region would be accepted and stored against that one
   * unit, reaching nobody — the link does not cascade down the tree — and the
   * mistake would only surface when somebody asked why a branch never heard
   * about a session scheduled for their region.
   */
  private async assertBranchesExist(branchIds: string[]): Promise<void> {
    const found = await this.prisma.orgUnit.count({
      where: { id: { in: branchIds }, isActive: true, type: 'BRANCH' },
    });
    if (found !== branchIds.length) {
      throw new BadRequestException({
        title: 'Not a branch',
        detail:
          'A session is held at a branch. One of the chosen units is a zone or region, has been ' +
          'switched off, or no longer exists.',
      });
    }
  }
}
