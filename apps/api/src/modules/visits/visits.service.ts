import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  assessVisitIntegrity,
  canRescheduleVisit,
  canTransitionVisit,
  assessCheckInLocation,
  locationQuality,
  visitEvidenceRules,
  DEFAULT_VISIT_MODE,
  type CancelVisitInput,
  type RescheduleVisitInput,
  type CheckInInput,
  type CheckOutInput,
  type PlanVisitInput,
  type VisitListItem,
  type VisitQuery,
  type CreateVisitExpenseInput,
  type VisitExpenseItem,
} from '@sihl-one/contracts';

import { AuditService } from '../../common/audit.service';
import { OutboxService } from '../../common/outbox.service';
import { ReferenceService } from '../../common/reference.service';
import { createFollowUpTask } from '../tasks/follow-up-task';
import { ScopeService } from '../../common/scope.service';
import { paginate, type AuthenticatedPrincipal, type PaginatedResult } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

type VisitRow = {
  id: string;
  reference: string;
  status: string;
  purpose: string;
  mode?: string;
  modeMaster?: {
    code: string;
    label: string;
    requiresPhoto: boolean;
    requiresGeo: boolean;
    requiresLink: boolean;
    allowsScreenshot: boolean;
  } | null;
  entityType: string;
  entityId: string;
  plannedAt: Date | null;
  checkInAt: Date | null;
  checkOutAt: Date | null;
  checkInLatitude: unknown;
  checkInLongitude: unknown;
  checkInAccuracy: unknown;
  checkOutLatitude: unknown;
  checkOutLongitude: unknown;
  checkOutAccuracy: unknown;
  durationMinutes: number | null;
  outcome: string | null;
  user?: { id: string; firstName: string; lastName: string } | null;
};

const toNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

@Injectable()
export class VisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly references: ReferenceService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly storage: StorageService,
  ) {}

  // -------------------------------------------------------------------------

  async plan(user: AuthenticatedPrincipal, input: PlanVisitInput) {
    const entityName = await this.assertEntityVisible(user, input.entityType, input.entityId);
    const mode = await this.mustFindMode(input.mode);
    const reference = await this.references.next('VS');

    const visit = await this.prisma.visit.create({
      data: {
        reference,
        entityType: input.entityType,
        entityId: input.entityId,
        userId: user.id,
        status: 'PLANNED',
        purpose: input.purpose,
        mode: mode.code,
        plannedAt: input.plannedAt ?? null,
      },
    });

    await this.audit.record({
      action: 'CREATE',
      resource: 'visit',
      resourceId: visit.id,
      changes: {
        reference,
        entityType: input.entityType,
        entityId: input.entityId,
        mode: mode.code,
      },
    });

    return this.findOne(user, visit.id, entityName);
  }

  /**
   * Check-in — the first of the two discrete location events ADR-0007 allows.
   *
   * Everything needed to make the record meaningful is captured here and never
   * again: where, when, how precisely, on what device, and a photograph. There
   * is no endpoint that adds a third point.
   */
  async checkIn(user: AuthenticatedPrincipal, visitId: string, input: CheckInInput) {
    const visit = await this.mustFindOwn(user, visitId);

    if (!canTransitionVisit(visit.status, 'CHECKED_IN')) {
      throw new BadRequestException({
        title: 'Cannot check in',
        detail:
          visit.status === 'CHECKED_IN'
            ? 'You are already checked in to this visit.'
            : `A visit in ${visit.status} status cannot be checked in to.`,
      });
    }

    const location = assessCheckInLocation(input);

    // What this mode demands. Read from the master rather than assumed, so an
    // administrator who adds a mode gets the behaviour they configured without
    // a release.
    const rules = visitEvidenceRules(await this.findMode(visit.mode));

    if (rules.photo && !input.photoKey) {
      throw new BadRequestException({
        title: 'Check-in photo required',
        detail:
          "A visit at the client's location must be checked in with a photo taken in the app.",
      });
    }

    // The photo must actually exist in storage. Without this a client could
    // post any string as `photoKey` and produce a check-in with no evidence.
    if (input.photoKey && !(await this.storage.exists(input.photoKey))) {
      throw new BadRequestException({
        title: 'Check-in photo not found',
        detail: 'Upload the photo first, then submit the check-in with the returned key.',
      });
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.visit.update({
        where: { id: visitId },
        data: {
          status: 'CHECKED_IN',
          checkInAt: now,
          checkInLatitude: input.latitude ?? null,
          checkInLongitude: input.longitude ?? null,
          checkInAccuracy: input.accuracy ?? null,
          // Recorded, never refused. A poor fix or a denied permission marks the
          // visit rather than stopping the rep entering one they actually made.
          locationStatus: location.status,
          locationReason: location.reason,
          checkInAddress: input.address ?? null,
          checkInPhotoKey: input.photoKey ?? null,
          deviceId: input.deviceId ?? null,
          deviceInfo: (input.deviceInfo ?? null) as never,
        },
      });

      await this.outbox.publish(tx, {
        aggregateType: 'visit',
        aggregateId: visitId,
        eventType: 'visit.checked_in',
        payload: {
          reference: visit.reference,
          userId: user.id,
          entityType: visit.entityType,
          entityId: visit.entityId,
          at: now.toISOString(),
          accuracy: input.accuracy,
        },
      });
    });

    await this.audit.record({
      action: 'UPDATE',
      resource: 'visit.check_in',
      resourceId: visitId,
      // Coordinates are deliberately not written to the audit trail — the visit
      // row already holds them, and the audit table is read by more people.
      changes: { accuracy: input.accuracy, quality: locationQuality(input.accuracy) },
    });

    return this.findOne(user, visitId);
  }

  /**
   * Check-out — the second and final location event.
   *
   * Computes duration, assesses whether the evidence hangs together, and writes
   * the meeting on to the parent record's timeline so the visit is part of the
   * relationship history rather than a separate silo.
   */
  async checkOut(user: AuthenticatedPrincipal, visitId: string, input: CheckOutInput) {
    const visit = await this.mustFindOwn(user, visitId);

    if (!canTransitionVisit(visit.status, 'COMPLETED')) {
      throw new BadRequestException({
        title: 'Cannot check out',
        detail:
          visit.status === 'PLANNED'
            ? 'Check in before checking out.'
            : `A visit in ${visit.status} status cannot be completed.`,
      });
    }
    if (!visit.checkInAt) {
      throw new BadRequestException({
        title: 'Cannot check out',
        detail: 'This visit has no check-in time.',
      });
    }

    const now = new Date();
    const durationMinutes = Math.max(
      0,
      Math.round((now.getTime() - visit.checkInAt.getTime()) / 60_000),
    );

    // Either end may now be missing a fix, so neither can be assumed present.
    // `Number(null)` is 0, which would have placed the visit off the coast of
    // Africa and then flagged the drift as suspicious.
    const rules = visitEvidenceRules(await this.findMode(visit.mode));

    // Drawn before the transaction opens: the counter is its own write on its
    // own connection, so pulling it inside would burn the number anyway if the
    // transaction rolled back. A gap in the sequence is harmless; a reference
    // reused across two tasks would not be.
    const followUpReference = input.nextFollowUpAt ? await this.references.next('TK') : null;

    const integrity = assessVisitIntegrity({
      checkIn:
        visit.checkInLatitude !== null && visit.checkInLongitude !== null
          ? { latitude: Number(visit.checkInLatitude), longitude: Number(visit.checkInLongitude) }
          : null,
      checkOut:
        input.latitude !== undefined && input.longitude !== undefined
          ? { latitude: input.latitude, longitude: input.longitude }
          : null,
      checkInAccuracy: toNumber(visit.checkInAccuracy),
      hasCheckedIn: visit.checkInAt !== null,
      expectsLocation: rules.geo,
      checkOutAccuracy: input.accuracy ?? null,
      durationMinutes,
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.visit.update({
        where: { id: visitId },
        data: {
          status: 'COMPLETED',
          checkOutAt: now,
          checkOutLatitude: input.latitude ?? null,
          checkOutLongitude: input.longitude ?? null,
          checkOutAccuracy: input.accuracy ?? null,
          durationMinutes,
          meetingNotes: input.meetingNotes,
          outcome: input.outcome ?? null,
          nextFollowUpAt: input.nextFollowUpAt ?? null,
          voiceNoteKey: input.voiceNoteKey ?? null,
        },
      });

      // The visit belongs on the customer's story, not only in a visits report.
      await tx.activity.create({
        data: {
          entityType: visit.entityType,
          entityId: visit.entityId,
          type: 'VISIT',
          direction: 'OUTBOUND',
          subject: `Field visit — ${visit.purpose}`,
          body: input.meetingNotes,
          outcome: input.outcome ?? null,
          durationMinutes,
          occurredAt: visit.checkInAt!,
          actorId: user.id,
          metadata: {
            visitId,
            visitReference: visit.reference,
            driftMetres: integrity.driftMetres,
          } as never,
        },
      });

      if (visit.entityType === 'LEAD') {
        await tx.lead.update({
          where: { id: visit.entityId },
          data: {
            lastActivityAt: now,
            nextFollowUpAt: input.nextFollowUpAt ?? undefined,
          },
        });
      } else if (visit.entityType === 'CUSTOMER') {
        await tx.customer.update({
          where: { id: visit.entityId },
          data: { lastActivityAt: now },
        });
      }

      // A follow-up booked at the door has to land somewhere the rep looks.
      // Writing the date onto the lead alone put it in the pipeline's overdue
      // count and nowhere else, so the commitment made at the end of a visit
      // never reached the Tasks screen.
      //
      // Assigned to whoever owns the visit rather than to the caller: a manager
      // closing out a visit on a rep's behalf is booking the rep's follow-up,
      // not their own.
      if (input.nextFollowUpAt && followUpReference) {
        await createFollowUpTask(tx, {
          reference: followUpReference,
          entityType: visit.entityType,
          entityId: visit.entityId,
          dueAt: input.nextFollowUpAt,
          context: visit.purpose,
          assigneeId: visit.userId,
          createdById: user.id,
        });
      }

      await this.outbox.publish(tx, {
        aggregateType: 'visit',
        aggregateId: visitId,
        eventType: 'visit.completed',
        payload: {
          reference: visit.reference,
          userId: user.id,
          entityType: visit.entityType,
          entityId: visit.entityId,
          durationMinutes,
          requiresReview: integrity.requiresReview,
          driftMetres: integrity.driftMetres,
        },
      });
    });

    await this.audit.record({
      action: 'UPDATE',
      resource: 'visit.check_out',
      resourceId: visitId,
      changes: {
        durationMinutes,
        driftMetres: integrity.driftMetres,
        requiresReview: integrity.requiresReview,
      },
    });

    return this.findOne(user, visitId);
  }

  async cancel(user: AuthenticatedPrincipal, visitId: string, input: CancelVisitInput) {
    const visit = await this.mustFindOwn(user, visitId);

    if (!canTransitionVisit(visit.status, 'CANCELLED')) {
      throw new BadRequestException({
        title: 'Cannot cancel',
        detail: `A visit in ${visit.status} status cannot be cancelled.`,
      });
    }

    await this.prisma.visit.update({
      where: { id: visitId },
      data: { status: 'CANCELLED', meetingNotes: input.reason },
    });

    await this.audit.record({
      action: 'UPDATE',
      resource: 'visit.cancel',
      resourceId: visitId,
      reason: input.reason,
    });

    return this.findOne(user, visitId);
  }

  /**
   * Move a planned visit to a different time.
   *
   * Deliberately not a general edit. Only the time moves; the lead, the mode,
   * the purpose and the owner all stay put, because every one of those changes
   * what the visit *is* rather than correcting when it was meant to happen.
   */
  async reschedule(
    user: AuthenticatedPrincipal,
    visitId: string,
    input: RescheduleVisitInput,
  ) {
    // Deliberately *not* mustFindOwn. That rule exists because a check-in
    // asserts a specific person was somewhere, so nobody may record one on
    // another's behalf. Moving a date asserts nothing of the kind — it is a
    // correction to a plan, and a manager who spots a mistyped date in their
    // branch should be able to fix it without going back to the rep. Normal
    // data scope applies instead.
    const visit = await this.prisma.visit.findFirst({
      where: { id: visitId, AND: [this.scope.visitScope(user)] },
    });

    if (!visit) {
      throw new NotFoundException({
        title: 'Visit not found',
        detail: 'No visit with that id is visible to you.',
      });
    }

    if (!canRescheduleVisit(visit.status)) {
      throw new BadRequestException({
        title: 'Cannot change the date',
        detail:
          visit.status === 'CHECKED_IN' || visit.status === 'COMPLETED'
            ? 'This visit has already started, so its planned time is now part of what happened. Record the correction in the visit notes instead.'
            : `A visit in ${visit.status} status cannot be rescheduled.`,
      });
    }

    const from = visit.plannedAt;

    await this.prisma.visit.update({
      where: { id: visitId },
      data: { plannedAt: input.plannedAt },
    });

    // The old time is the whole point of the record: "moved" means nothing
    // without saying moved from what.
    await this.audit.record({
      action: 'UPDATE',
      resource: 'visit.reschedule',
      resourceId: visitId,
      reason: input.reason,
      changes: {
        plannedAt: {
          from: from?.toISOString() ?? null,
          to: input.plannedAt.toISOString(),
        },
      },
    });

    return this.findOne(user, visitId);
  }

  // -------------------------------------------------------------------------

  async list(
    user: AuthenticatedPrincipal,
    query: VisitQuery,
  ): Promise<PaginatedResult<VisitListItem>> {
    const and: Record<string, unknown>[] = [this.scope.visitScope(user)];

    if (query.status) and.push({ status: query.status });
    if (query.userId) and.push({ userId: query.userId });
    if (query.entityType) and.push({ entityType: query.entityType });
    if (query.entityId) and.push({ entityId: query.entityId });
    if (query.from || query.to) {
      and.push({
        createdAt: {
          ...(query.from ? { gte: query.from } : {}),
          ...(query.to ? { lte: query.to } : {}),
        },
      });
    }

    const where = { AND: and };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.visit.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
        modeMaster: {
          select: {
            code: true,
            label: true,
            requiresPhoto: true,
            requiresGeo: true,
            requiresLink: true,
            allowsScreenshot: true,
          },
        },
        },
      }),
      this.prisma.visit.count({ where }),
    ]);

    const names = await this.resolveEntityNames(rows);
    let items = rows.map((row) => this.toListItem(row as unknown as VisitRow, names));

    // Applied after mapping because "needs review" is derived from the geometry
    // rather than stored — see the note on VisitIntegrity.
    if (query.needsReview) items = items.filter((item) => item.requiresReview);

    return paginate(items, total, query.page, query.pageSize);
  }

  async findOne(user: AuthenticatedPrincipal, visitId: string, knownEntityName?: string | null) {
    const visit = await this.prisma.visit.findFirst({
      where: { id: visitId, AND: [this.scope.visitScope(user)] },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        modeMaster: {
          select: {
            code: true,
            label: true,
            requiresPhoto: true,
            requiresGeo: true,
            requiresLink: true,
            allowsScreenshot: true,
          },
        },
      },
    });

    if (!visit) {
      throw new NotFoundException({
        title: 'Visit not found',
        detail: 'No visit with that id is visible to you.',
      });
    }

    const entityName =
      knownEntityName ?? (await this.lookupEntityName(visit.entityType, visit.entityId));

    const integrity = assessVisitIntegrity({
      checkIn:
        visit.checkInLatitude !== null && visit.checkInLongitude !== null
          ? { latitude: Number(visit.checkInLatitude), longitude: Number(visit.checkInLongitude) }
          : null,
      checkOut:
        visit.checkOutLatitude !== null && visit.checkOutLongitude !== null
          ? { latitude: Number(visit.checkOutLatitude), longitude: Number(visit.checkOutLongitude) }
          : null,
      checkInAccuracy: toNumber(visit.checkInAccuracy),
      hasCheckedIn: visit.checkInAt !== null,
      expectsLocation: visitEvidenceRules(visit.modeMaster).geo,
      checkOutAccuracy: toNumber(visit.checkOutAccuracy),
      durationMinutes: visit.durationMinutes,
    });

    // The selfie is exposed as a short-lived signed link, never as a raw key.
    const photo = visit.checkInPhotoKey
      ? this.storage.signDownload(visit.checkInPhotoKey, user.id)
      : null;

    return {
      id: visit.id,
      reference: visit.reference,
      status: visit.status,
      purpose: visit.purpose,
      mode: visit.mode ?? DEFAULT_VISIT_MODE,
      modeLabel: visit.modeMaster?.label ?? null,
      // The same rules the server enforces, sent to the client so the two
      // cannot disagree about whether a photo is needed.
      evidence: visitEvidenceRules(visit.modeMaster),
      entityType: visit.entityType,
      entityId: visit.entityId,
      entityName,
      user: visit.user
        ? {
            id: visit.user.id,
            fullName: `${visit.user.firstName} ${visit.user.lastName}`.trim(),
            email: visit.user.email,
          }
        : null,
      plannedAt: visit.plannedAt?.toISOString() ?? null,
      checkIn: visit.checkInAt
        ? {
            at: visit.checkInAt.toISOString(),
            latitude: toNumber(visit.checkInLatitude),
            longitude: toNumber(visit.checkInLongitude),
            accuracy: toNumber(visit.checkInAccuracy),
            quality: locationQuality(toNumber(visit.checkInAccuracy)),
            address: visit.checkInAddress,
            photoUrl: photo
              ? `/visits/${visit.id}/photo?token=${encodeURIComponent(photo.token)}`
              : null,
          }
        : null,
      checkOut: visit.checkOutAt
        ? {
            at: visit.checkOutAt.toISOString(),
            latitude: toNumber(visit.checkOutLatitude),
            longitude: toNumber(visit.checkOutLongitude),
            accuracy: toNumber(visit.checkOutAccuracy),
            quality: locationQuality(toNumber(visit.checkOutAccuracy)),
          }
        : null,
      durationMinutes: visit.durationMinutes,
      meetingNotes: visit.meetingNotes,
      outcome: visit.outcome,
      nextFollowUpAt: visit.nextFollowUpAt?.toISOString() ?? null,
      integrity,
      createdAt: visit.createdAt.toISOString(),
    };
  }

  async photo(user: AuthenticatedPrincipal, visitId: string, token: string) {
    const visit = await this.prisma.visit.findFirst({
      where: { id: visitId, AND: [this.scope.visitScope(user)] },
      select: { checkInPhotoKey: true },
    });

    if (!visit?.checkInPhotoKey) throw new NotFoundException({ title: 'No check-in photo' });

    if (!this.storage.verifyDownload(visit.checkInPhotoKey, user.id, token)) {
      throw new ForbiddenException({
        title: 'Photo link is invalid or has expired',
        detail: 'Reload the visit to get a fresh link.',
      });
    }

    return {
      body: await this.storage.read(visit.checkInPhotoKey),
      contentType: 'image/jpeg',
    };
  }

  /** Today's plan for the signed-in user, for the mobile home screen. */
  async today(user: AuthenticatedPrincipal) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86_400_000);

    const [planned, inProgress, completedToday] = await this.prisma.$transaction([
      this.prisma.visit.findMany({
        where: {
          userId: user.id,
          status: 'PLANNED',
          OR: [{ plannedAt: { gte: start, lt: end } }, { plannedAt: null }],
        },
        orderBy: [{ plannedAt: 'asc' }],
        take: 20,
      }),
      this.prisma.visit.findFirst({ where: { userId: user.id, status: 'CHECKED_IN' } }),
      this.prisma.visit.count({
        where: { userId: user.id, status: 'COMPLETED', checkOutAt: { gte: start, lt: end } },
      }),
    ]);

    const names = await this.resolveEntityNames([
      ...planned,
      ...(inProgress ? [inProgress] : []),
    ] as unknown as VisitRow[]);

    return {
      // At most one visit can be open at a time; the UI uses this to send the
      // user straight to the check-out screen rather than a list.
      inProgress: inProgress
        ? this.toListItem(inProgress as unknown as VisitRow, names)
        : null,
      planned: planned.map((visit) => this.toListItem(visit as unknown as VisitRow, names)),
      completedToday,
    };
  }

  // -------------------------------------------------------------------------

  private toListItem(visit: VisitRow, names: Map<string, string>): VisitListItem {
    const integrity = assessVisitIntegrity({
      checkIn:
        visit.checkInLatitude !== null && visit.checkInLatitude !== undefined
          ? { latitude: Number(visit.checkInLatitude), longitude: Number(visit.checkInLongitude) }
          : null,
      checkOut:
        visit.checkOutLatitude !== null && visit.checkOutLatitude !== undefined
          ? { latitude: Number(visit.checkOutLatitude), longitude: Number(visit.checkOutLongitude) }
          : null,
      checkInAccuracy: toNumber(visit.checkInAccuracy),
      hasCheckedIn: visit.checkInAt !== null,
      expectsLocation: visitEvidenceRules(visit.modeMaster).geo,
      checkOutAccuracy: toNumber(visit.checkOutAccuracy),
      durationMinutes: visit.durationMinutes,
    });

    return {
      id: visit.id,
      reference: visit.reference,
      status: visit.status as VisitListItem['status'],
      purpose: visit.purpose,
      mode: visit.mode ?? DEFAULT_VISIT_MODE,
      modeLabel: visit.modeMaster?.label ?? null,
      entityType: visit.entityType,
      entityId: visit.entityId,
      entityName: names.get(`${visit.entityType}:${visit.entityId}`) ?? null,
      user: visit.user
        ? { id: visit.user.id, fullName: `${visit.user.firstName} ${visit.user.lastName}`.trim() }
        : null,
      plannedAt: visit.plannedAt?.toISOString() ?? null,
      checkInAt: visit.checkInAt?.toISOString() ?? null,
      checkOutAt: visit.checkOutAt?.toISOString() ?? null,
      durationMinutes: visit.durationMinutes,
      outcome: visit.outcome,
      locationQuality: locationQuality(toNumber(visit.checkInAccuracy)),
      requiresReview: integrity.requiresReview,
      isOverdue: Boolean(
        visit.status === 'PLANNED' && visit.plannedAt && visit.plannedAt < new Date(),
      ),
    };
  }

  /**
   * Resolves lead and customer names for a page of visits in two queries rather
   * than one per row — the classic N+1 that only shows up once a rep has a
   * month of history.
   */
  private async resolveEntityNames(visits: VisitRow[]): Promise<Map<string, string>> {
    const leadIds = visits.filter((v) => v.entityType === 'LEAD').map((v) => v.entityId);
    const customerIds = visits.filter((v) => v.entityType === 'CUSTOMER').map((v) => v.entityId);
    const names = new Map<string, string>();

    if (leadIds.length) {
      const leads = await this.prisma.lead.findMany({
        where: { id: { in: leadIds } },
        select: { id: true, firstName: true, lastName: true },
      });
      for (const lead of leads) {
        names.set(`LEAD:${lead.id}`, `${lead.firstName} ${lead.lastName ?? ''}`.trim());
      }
    }

    if (customerIds.length) {
      const customers = await this.prisma.customer.findMany({
        where: { id: { in: customerIds } },
        select: { id: true, firstName: true, lastName: true },
      });
      for (const customer of customers) {
        names.set(
          `CUSTOMER:${customer.id}`,
          `${customer.firstName} ${customer.lastName ?? ''}`.trim(),
        );
      }
    }

    return names;
  }

  private async lookupEntityName(entityType: string, entityId: string): Promise<string | null> {
    const names = await this.resolveEntityNames([{ entityType, entityId } as VisitRow]);
    return names.get(`${entityType}:${entityId}`) ?? null;
  }

  /**
   * A visit may only be acted on by the person who made it.
   *
   * A manager can *see* their team's visits but cannot check in on someone
   * else's behalf — a check-in asserts that a specific person was physically
   * somewhere, and letting anyone else record it destroys the meaning of the
   * record.
   */
  /**
   * The evidence flags for a mode, or null when it cannot be found.
   *
   * Null is not an error here: `visitEvidenceRules` treats an unknown mode as
   * the strictest one, so a missing master row fails towards asking for more
   * evidence rather than less.
   */
  private async findMode(code: string) {
    return this.prisma.meetingModeMaster.findUnique({
      where: { code },
      select: {
        code: true,
        label: true,
        requiresPhoto: true,
        requiresGeo: true,
        requiresLink: true,
        allowsScreenshot: true,
      },
    });
  }

  /**
   * The mode a visit is being planned in, refusing anything unusable.
   *
   * The foreign key would catch an unknown code, but as a 500-shaped database
   * error naming a constraint. A rep who picked a mode an administrator retired
   * between page load and submit deserves a sentence they can act on.
   */
  private async mustFindMode(code: string) {
    const mode = await this.prisma.meetingModeMaster.findUnique({
      where: { code },
      select: { code: true, label: true, isActive: true },
    });

    if (!mode) {
      throw new BadRequestException({
        title: 'Unknown meeting mode',
        detail: `"${code}" is not a meeting mode. Choose one from the list.`,
      });
    }
    if (!mode.isActive) {
      throw new BadRequestException({
        title: 'Meeting mode withdrawn',
        detail: `"${mode.label}" is no longer available. Choose another.`,
      });
    }

    return mode;
  }

  private async mustFindOwn(user: AuthenticatedPrincipal, visitId: string) {
    const visit = await this.prisma.visit.findFirst({ where: { id: visitId } });

    if (!visit || (visit.userId !== user.id && user.dataScope !== 'ALL')) {
      throw new NotFoundException({
        title: 'Visit not found',
        detail: 'No visit with that id is visible to you.',
      });
    }
    if (visit.userId !== user.id) {
      throw new ForbiddenException({
        title: 'This is not your visit',
        detail: 'A visit can only be checked in or out by the person making it.',
      });
    }
    return visit;
  }

  private async assertEntityVisible(
    user: AuthenticatedPrincipal,
    entityType: string,
    entityId: string,
  ): Promise<string | null> {
    if (entityType === 'LEAD') {
      const lead = await this.prisma.lead.findFirst({
        where: { id: entityId, deletedAt: null, AND: [this.scope.leadScope(user)] },
        select: { firstName: true, lastName: true },
      });
      if (!lead) throw new ForbiddenException({ title: 'Lead not accessible' });
      return `${lead.firstName} ${lead.lastName ?? ''}`.trim();
    }

    if (entityType === 'CUSTOMER') {
      const customer = await this.prisma.customer.findFirst({
        where: { id: entityId, deletedAt: null, AND: [this.scope.customerScope(user)] },
        select: { firstName: true, lastName: true },
      });
      if (!customer) throw new ForbiddenException({ title: 'Customer not accessible' });
      return `${customer.firstName} ${customer.lastName ?? ''}`.trim();
    }

    throw new BadRequestException({
      title: 'Unsupported visit target',
      detail: 'Visits can currently be planned against leads and customers.',
    });
  }

  // -------------------------------------------------------------------------
  // Expenses
  // -------------------------------------------------------------------------

  /**
   * Claim an expense against a visit.
   *
   * Only the person who made the visit may claim for it. A manager can see the
   * claim — that is what the scope filter is for — but claiming on someone
   * else's behalf would put a spend in their name that they never entered, and
   * this record is read by finance.
   */
  async addExpense(user: AuthenticatedPrincipal, visitId: string, input: CreateVisitExpenseInput) {
    const visit = await this.prisma.visit.findFirst({
      where: { id: visitId, AND: [this.scope.visitScope(user)] },
      select: { id: true, userId: true, status: true },
    });
    if (!visit) throw new NotFoundException({ title: 'Visit not found' });

    if (visit.userId !== user.id) {
      throw new ForbiddenException({
        title: 'Not your visit',
        detail: 'Expenses are claimed by the person who made the visit.',
      });
    }

    if (visit.status === 'CANCELLED') {
      throw new BadRequestException({
        title: 'Visit was cancelled',
        detail: 'A cancelled visit cannot carry an expense claim.',
      });
    }

    const created = await this.prisma.visitExpense.create({
      data: {
        visitId,
        category: input.category,
        amount: input.amount,
        note: input.note ?? null,
        receiptKey: input.receiptKey ?? null,
        claimedById: user.id,
      },
    });

    await this.audit.record({
      action: 'CREATE',
      resource: 'visit.expense',
      resourceId: created.id,
      changes: { visitId, category: created.category, amount: input.amount },
    });

    return this.toExpenseItem(created);
  }

  async listExpenses(user: AuthenticatedPrincipal, visitId: string): Promise<VisitExpenseItem[]> {
    const visit = await this.prisma.visit.findFirst({
      where: { id: visitId, AND: [this.scope.visitScope(user)] },
      select: { id: true },
    });
    if (!visit) throw new NotFoundException({ title: 'Visit not found' });

    const rows = await this.prisma.visitExpense.findMany({
      where: { visitId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => this.toExpenseItem(row));
  }

  private toExpenseItem(row: {
    id: string;
    category: string;
    amount: unknown;
    note: string | null;
    receiptKey: string | null;
    createdAt: Date;
  }): VisitExpenseItem {
    return {
      id: row.id,
      category: row.category as VisitExpenseItem['category'],
      // Decimal to string, never through a Number — and always two places.
      // String(Decimal) drops a trailing zero, so 450.50 comes back as "450.5",
      // which is numerically right and wrong on a page of money.
      amount: (row.amount as { toFixed(dp: number): string }).toFixed(2),
      note: row.note,
      // The key itself is not exposed: it is a storage path, and the download
      // route is what decides who may read it.
      hasReceipt: Boolean(row.receiptKey),
      claimedAt: row.createdAt.toISOString(),
    };
  }

}
