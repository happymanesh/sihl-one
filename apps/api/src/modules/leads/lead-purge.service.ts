import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  maskMobile,
  type LeadPurgeCounts,
  type LeadPurgePreview,
  type LeadPurgeResult,
  type LeadPurgeRetained,
  type PurgeLeadInput,
} from '@sihl-one/contracts';

import { AuditService } from '../../common/audit.service';
import type { AuthenticatedPrincipal } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { Prisma } from '../../generated/prisma/client';

/**
 * Permanent destruction of one lead.
 *
 * This is the only hard delete in the system and it is kept away from
 * `LeadsService` for that reason. `LeadsService.remove` stamps `deletedAt` and
 * the row stays — it is still in the database, still in the duplicate check,
 * still recoverable by an administrator. Nothing here is recoverable. The two
 * live in different files so that nobody reaches for the wrong one, and so the
 * diff that changes this behaviour is never buried in a four-thousand-line
 * file about the pipeline.
 *
 * Who may call it is settled before the request reaches this class:
 * `lead:purge` is granted to super admin and to no other role. There is
 * deliberately **no ABAC row filter** on the lookup, which is a departure from
 * the house idiom (`AND: [this.scope.leadScope(user)]`) and worth saying why:
 *
 *   - The only role holding the permission has `ALL` scope, so composing the
 *     filter would be a no-op that implies a row-level restriction nobody has.
 *   - Worse, it would make "not found" ambiguous — no such lead, or one you
 *     cannot see? On a read that ambiguity is a feature. On an irreversible
 *     delete it is how somebody concludes they are pointed at the wrong
 *     environment, goes looking for the lead somewhere else, and purges it
 *     there.
 *
 * `deletedAt` is not filtered either. An already soft-deleted lead is the
 * single most likely subject of a purge, and refusing to find it would mean
 * un-deleting a record in order to destroy it.
 */
@Injectable()
export class LeadPurgeService {
  private readonly logger = new Logger(LeadPurgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /** What a purge would take, without taking it. */
  async preview(reference: string): Promise<LeadPurgePreview> {
    const lead = await this.mustFind(this.prisma, reference);
    return this.survey(this.prisma, lead);
  }

  /**
   * Destroys the lead and everything owned by it.
   *
   * The audit row is written **before** the transaction opens, through
   * `AuditService`, which holds the root Prisma client rather than the
   * transactional one. That is deliberate on both counts. Writing it first
   * means the trail cannot be lost with the rows it describes; writing it off
   * the root client means a transaction that then fails and rolls back leaves
   * the audit row standing. An audit row for a purge that did not complete is
   * a question somebody can answer by looking; a purge with no audit row is
   * not.
   */
  async purge(
    user: AuthenticatedPrincipal,
    reference: string,
    input: PurgeLeadInput,
  ): Promise<LeadPurgeResult> {
    /*
      The number in the path and the number the user typed must agree.

      Both have already been normalised to upper case by the schema, so this
      compares what was clicked against what was typed and nothing else. It is
      the whole of the confirmation step: without it the body is a formality
      the browser could fill in.
    */
    if (input.confirmReference !== reference) {
      throw new BadRequestException({
        title: 'Confirmation does not match',
        detail: `You typed ${input.confirmReference}; this request is for ${reference}.`,
        errors: { confirmReference: ['Type the lead number exactly as it appears above.'] },
      });
    }

    const lead = await this.mustFind(this.prisma, reference);
    const survey = await this.survey(this.prisma, lead);

    await this.audit.record({
      action: 'DELETE',
      resource: 'lead.purge',
      /*
        `AuditLog.resourceId` is a plain VarChar with no foreign key onto
        `lead` — checked, because a key here with ON DELETE CASCADE would
        delete the evidence along with the subject. The reference is repeated
        inside `changes` so the row is still readable by a human once the id
        resolves to nothing.
      */
      resourceId: lead.id,
      reason: input.reason,
      changes: {
        hardDelete: true,
        reference: lead.reference,
        leadId: lead.id,
        name: survey.name,
        // Masked by the audit sanitiser in any case; passed already masked so
        // the full number is never held in memory on its way there.
        mobile: survey.mobile,
        status: lead.status,
        ownerId: lead.ownerId,
        wasSoftDeleted: lead.deletedAt !== null,
        destroyed: survey.counts,
        retained: survey.retained,
        storedFiles: survey.storedFiles,
        expenseClaimTotal: survey.expenseClaimTotal,
      },
    });

    const keys = await this.prisma.$transaction(async (tx) => {
      const storageKeys = await this.collectStorageKeys(tx, lead.id);
      await this.destroy(tx, lead.id);
      return storageKeys;
    });

    /*
      The file store is touched only once the rows are committed.

      It is not transactional and cannot be rolled back, so doing it inside
      would mean a failed purge that had already destroyed the documents of a
      lead still sitting in the database. This way the worst case is the other
      one: objects left behind with nothing pointing at them, which the audit
      row lists by count and which a sweep can find later.
    */
    const removal = await this.removeFiles(keys, lead.reference);

    return {
      ...survey,
      purgedAt: new Date().toISOString(),
      filesRemoved: removal.removed,
      filesFailed: removal.failed,
    };
  }

  // -------------------------------------------------------------------------

  /**
   * The lead, by its human-facing number.
   *
   * `Lead.reference` carries `@unique`, so `findUnique` can return one row or
   * none and there is no third case to handle — the database refuses a second
   * `LD-2026-000123` rather than this code having to choose between two. That
   * is the reason the lookup is by reference at all: an ambiguous match on an
   * irreversible delete is not something to resolve, it is something to make
   * impossible.
   */
  private async mustFind(client: Prisma.TransactionClient, reference: string) {
    const lead = await client.lead.findUnique({
      where: { reference },
      select: {
        id: true,
        reference: true,
        firstName: true,
        lastName: true,
        mobile: true,
        status: true,
        ownerId: true,
        customerId: true,
        createdAt: true,
        deletedAt: true,
        owner: { select: { firstName: true, lastName: true } },
      },
    });

    if (!lead) {
      throw new NotFoundException({
        title: 'No such lead',
        detail: `No lead carries the number ${reference}.`,
      });
    }

    return lead;
  }

  /** Everything the preview shows and the audit row records, counted. */
  private async survey(
    client: Prisma.TransactionClient,
    lead: Awaited<ReturnType<LeadPurgeService['mustFind']>>,
  ): Promise<LeadPurgePreview> {
    const leadId = lead.id;
    const polymorphic = { entityType: 'LEAD', entityId: leadId } as const;

    const [activities, tasks, visits] = await Promise.all([
      client.activity.findMany({ where: polymorphic, select: { id: true } }),
      client.task.findMany({ where: polymorphic, select: { id: true } }),
      client.visit.findMany({
        where: polymorphic,
        select: { id: true, checkInPhotoKey: true, voiceNoteKey: true },
      }),
    ]);

    const activityIds = activities.map((row) => row.id);
    const taskIds = tasks.map((row) => row.id);
    const visitIds = visits.map((row) => row.id);

    const expenses = await client.visitExpense.findMany({
      where: { visitId: { in: visitIds } },
      select: { amount: true, receiptKey: true },
    });

    const [
      activityProductValues,
      attendees,
      documents,
      leadProducts,
      productApprovals,
      statusHistory,
      familyMembers,
      profile,
      consentRecords,
      eventAttendances,
      presentationBookings,
      messageLogs,
      mobileOtps,
      notifications,
      importRows,
      outboxEvents,
      mergedLeads,
      messageOptOuts,
      duplicateCitations,
    ] = await Promise.all([
      client.activityProductValue.count({ where: { activityId: { in: activityIds } } }),
      client.attendee.count({
        where: { OR: [{ taskId: { in: taskIds } }, { visitId: { in: visitIds } }] },
      }),
      client.document.count({
        where: { OR: [polymorphic, { activityId: { in: activityIds } }] },
      }),
      client.leadProduct.count({ where: { leadId } }),
      client.leadProductApproval.count({ where: { leadId } }),
      client.leadStatusHistory.count({ where: { leadId } }),
      client.leadFamilyMember.count({ where: { leadId } }),
      client.leadProfile.count({ where: { leadId } }),
      client.consentRecord.count({ where: { leadId } }),
      client.eventAttendance.count({ where: { leadId } }),
      client.presentationBooking.count({ where: { leadId } }),
      client.messageLog.count({ where: { leadId } }),
      client.mobileOtp.count({ where: { leadId } }),
      client.notification.count({ where: polymorphic }),
      client.leadImportRow.count({ where: { createdLeadId: leadId } }),
      client.outboxEvent.count({ where: { aggregateType: 'lead', aggregateId: leadId } }),
      client.lead.count({ where: { mergedIntoId: leadId } }),
      client.messageOptOut.count({ where: polymorphic }),
      client.leadImportRow.count({ where: { duplicateOfLeadId: leadId } }),
    ]);

    const counts: LeadPurgeCounts = {
      activities: activities.length,
      activityProductValues,
      tasks: tasks.length,
      visits: visits.length,
      visitExpenses: expenses.length,
      attendees,
      documents,
      leadProducts,
      productApprovals,
      statusHistory,
      familyMembers,
      profile,
      consentRecords,
      eventAttendances,
      presentationBookings,
      messageLogs,
      mobileOtps,
      notifications,
      importRows,
      outboxEvents,
    };

    const retained: LeadPurgeRetained = {
      mergedLeads,
      customer: lead.customerId !== null,
      messageOptOuts,
      duplicateCitations,
    };

    const storedFiles =
      documents +
      visits.filter((row) => row.checkInPhotoKey).length +
      visits.filter((row) => row.voiceNoteKey).length +
      expenses.filter((row) => row.receiptKey).length;

    return {
      leadId,
      reference: lead.reference,
      name: [lead.firstName, lead.lastName].filter(Boolean).join(' '),
      mobile: maskMobile(lead.mobile),
      status: lead.status,
      owner: lead.owner
        ? [lead.owner.firstName, lead.owner.lastName].filter(Boolean).join(' ')
        : null,
      createdAt: lead.createdAt.toISOString(),
      deletedAt: lead.deletedAt?.toISOString() ?? null,
      counts,
      retained,
      storedFiles,
      expenseClaimTotal: totalRupees(expenses.map((row) => row.amount)),
    };
  }

  /**
   * Every object key that belongs to this lead.
   *
   * Read inside the transaction, before the rows go, because afterwards there
   * is nothing left to read them from.
   */
  private async collectStorageKeys(
    tx: Prisma.TransactionClient,
    leadId: string,
  ): Promise<string[]> {
    const polymorphic = { entityType: 'LEAD', entityId: leadId } as const;

    const activities = await tx.activity.findMany({ where: polymorphic, select: { id: true } });
    const visits = await tx.visit.findMany({
      where: polymorphic,
      select: { id: true, checkInPhotoKey: true, voiceNoteKey: true },
    });

    const documents = await tx.document.findMany({
      where: {
        OR: [polymorphic, { activityId: { in: activities.map((row) => row.id) } }],
      },
      select: { storageKey: true },
    });
    const expenses = await tx.visitExpense.findMany({
      where: { visitId: { in: visits.map((row) => row.id) } },
      select: { receiptKey: true },
    });

    return [
      ...documents.map((row) => row.storageKey),
      ...visits.flatMap((row) => [row.checkInPhotoKey, row.voiceNoteKey]),
      ...expenses.map((row) => row.receiptKey),
    ].filter((key): key is string => Boolean(key));
  }

  /**
   * The deletes themselves, in one transaction so a partial purge is
   * impossible.
   *
   * Three kinds of relation hang off a lead and only one of them looks after
   * itself:
   *
   *  1. **Foreign keys that already cascade.** `LeadProduct`, `LeadProfile`,
   *     `LeadFamilyMember`, `LeadProductApproval`, `LeadStatusHistory`,
   *     `ConsentRecord`, `EventAttendance` and `PresentationBooking` all
   *     carry `onDelete: Cascade` and go when the lead row goes. Nothing is
   *     written for them here; writing it would be a second, drifting
   *     statement of a rule the database already holds.
   *
   *  2. **Polymorphic children with no foreign key at all.** `Activity`,
   *     `Task`, `Visit`, `Document`, `Notification` and `OutboxEvent` find
   *     their parent by `(entityType, entityId)` or `(aggregateType,
   *     aggregateId)`. The database knows nothing of the relationship, so
   *     every one of them is deleted explicitly below — and they are the ones
   *     that would otherwise be left pointing at a lead that no longer
   *     exists.
   *
   *  3. **Foreign keys that null rather than cascade.** `MessageLog` and
   *     `MobileOtp` are `SetNull`, so the rows would survive the lead with
   *     their `leadId` emptied. Surviving is the wrong outcome: a message log
   *     holds the destination number and the rendered body, an OTP row holds
   *     the mobile, and a purge that leaves the person's number behind in two
   *     tables has not erased them. Both are deleted on purpose.
   *
   * What is *not* deleted, equally on purpose, is set out in
   * `LeadPurgeRetained`.
   */
  private async destroy(tx: Prisma.TransactionClient, leadId: string): Promise<void> {
    const polymorphic = { entityType: 'LEAD', entityId: leadId } as const;

    /*
      Documents first, then the activities.

      An evidence screenshot carries both `entityType = LEAD` and an
      `activityId`, so deleting activities first would cascade it away and the
      deleteMany below would report nothing. Order does not change the
      outcome, only whether the counts tell the truth about it.
    */
    await tx.document.deleteMany({ where: polymorphic });
    await tx.activity.deleteMany({ where: polymorphic });

    /*
      Tasks and visits, with their attendees.

      A task on a lead exists only because the lead does — its single link to
      anything is `(entityType, entityId)` — so it is the lead's and it goes.
      The `Attendee` rows cascade off it, and that is the right reading of
      them: an attendee row says "this colleague was expected at this
      meeting", not something about that colleague independently of it. The
      meeting is gone, so the expectation goes with it.

      `VisitExpense` cascades off the visit and is the one genuinely awkward
      case — an expense claim is money a rep says SIHL owes them, and it is
      not really the lead's to destroy. It cannot be kept: the foreign key is
      `onDelete: Cascade` and a claim with a dangling `visitId` is not a row
      the database will hold. So it goes, and the preview and the audit row
      both state the claim count and the rupee total before anybody confirms,
      which is the most this design can do about it.
    */
    await tx.task.deleteMany({ where: polymorphic });
    await tx.visit.deleteMany({ where: polymorphic });

    // Deep links into a record that is about to stop existing, carrying the
    // lead's name in their title.
    await tx.notification.deleteMany({ where: polymorphic });

    // See (3) above.
    await tx.messageLog.deleteMany({ where: { leadId } });
    await tx.mobileOtp.deleteMany({ where: { leadId } });

    /*
      The import rows this lead came from.

      `createdLeadId` is `SetNull`, so these would survive — and a `raw`
      column holding the original spreadsheet line is the most complete copy
      of the person's details anywhere in the system. Provenance for a lead
      that no longer exists is not a record anyone needs; the batch's own
      totals live on `LeadImportBatch` and are untouched.

      Rows that merely *cite* this lead as a duplicate belong to somebody
      else's import and are not ours to destroy, so they are detached instead.
    */
    await tx.leadImportRow.deleteMany({ where: { createdLeadId: leadId } });
    await tx.leadImportRow.updateMany({
      where: { duplicateOfLeadId: leadId },
      data: { duplicateOfLeadId: null },
    });

    /*
      Unrelayed integration events.

      `OutboxEvent` says dead-lettered rows are kept as evidence, and that
      rule is about the relay never dropping its own failures. This is a
      different actor with a different reason: the payload is a copy of the
      lead, and an unpublished `lead.created` relayed after the purge would
      reconstruct the person in whatever system consumes it. Leaving them
      would not preserve evidence, it would undo the erasure elsewhere.
    */
    await tx.outboxEvent.deleteMany({ where: { aggregateType: 'lead', aggregateId: leadId } });

    /*
      And the lead, which takes the eight cascading relations with it.

      `mergedInto`, `customer`, `owner`, `event`, `campaign`, `partner` and
      `importBatch` are all `SetNull` in the other direction — they are
      records this lead points *at*, not records that belong to it, and none
      of them is touched.
    */
    await tx.lead.delete({ where: { id: leadId } });
  }

  /**
   * Deletes the objects, and never lets a storage failure undo the purge.
   *
   * By the time this runs the database transaction has committed; throwing
   * here would report a failure for work that has already succeeded, and the
   * caller would reasonably try again against a lead that no longer exists.
   * A shortfall is counted, logged and returned instead.
   */
  private async removeFiles(
    keys: readonly string[],
    reference: string,
  ): Promise<{ removed: number; failed: number }> {
    let removed = 0;
    let failed = 0;

    for (const key of keys) {
      try {
        await this.storage.remove(key);
        removed += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(
          `PURGE LEFT A FILE BEHIND — lead ${reference}, object ${key}. ` +
            'The rows are gone; this object now has nothing pointing at it.',
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return { removed, failed };
  }
}

/**
 * Sums expense claims for display.
 *
 * Accumulated in paise as integers rather than added as floats: these are
 * rupee amounts read by a person deciding whether to destroy them, and
 * binary floating point cannot hold `12345.67` exactly. Prisma hands back a
 * Decimal, which stringifies without loss — the rounding is applied once, per
 * row, on a value that already has two decimal places.
 */
function totalRupees(amounts: readonly { toString(): string }[]): string {
  const paise = amounts.reduce<number>(
    (sum, amount) => sum + Math.round(Number(amount.toString()) * 100),
    0,
  );
  return (paise / 100).toFixed(2);
}
