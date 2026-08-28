import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  findMatches,
  indianMobileSchema,
  panSchema,
  parseDelimited,
  parseImportedAmount,
  parseProductInterest,
  scoreLead,
  splitFullName,
  suggestDecision,
  suggestMapping,
  type CommitImportInput,
  type ImportDeclaration,
  type ImportMapping,
  type ImportRowPreview,
  type MatchCandidate,
} from '@sihl-one/contracts';

import { AuditService } from '../../common/audit.service';
import { OutboxService } from '../../common/outbox.service';
import { ReferenceService } from '../../common/reference.service';
import type { AuthenticatedPrincipal } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AssignmentService } from '../assignment/assignment.service';

/** Guard against someone uploading a million-row file and taking the API down. */
const MAX_IMPORT_ROWS = 5000;

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly references: ReferenceService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly assignment: AssignmentService,
  ) {}

  // -------------------------------------------------------------------------
  // Step 1 — parse and stage
  // -------------------------------------------------------------------------

  /**
   * Parses the file, stages every row verbatim, and returns a suggested column
   * mapping for the user to confirm.
   *
   * Nothing is validated or created here. The raw rows are persisted so that
   * "what did the spreadsheet actually say" is answerable long after the import,
   * which matters when a lead's provenance is questioned.
   */
  async parse(
    user: AuthenticatedPrincipal,
    file: { fileName: string; text: string },
    declaration: ImportDeclaration,
  ) {
    const rows = parseDelimited(file.text);

    if (rows.length === 0) {
      throw new BadRequestException({
        title: 'Nothing to import',
        detail: 'The file contains no readable rows.',
      });
    }
    if (rows.length > MAX_IMPORT_ROWS + 1) {
      throw new BadRequestException({
        title: 'File is too large',
        detail: `Imports are limited to ${MAX_IMPORT_ROWS} rows. Split the file and import it in parts.`,
      });
    }

    const headers = rows[0]!;
    const reference = await this.references.next('IM');

    const batch = await this.prisma.leadImportBatch.create({
      data: {
        reference,
        fileName: file.fileName,
        status: 'PARSED',
        sourceOrigin: declaration.origin,
        suppliedBy: declaration.suppliedBy,
        sourceDescription: declaration.description,
        lawfulBasisConfirmedAt: new Date(),
        totalRows: rows.length - 1,
        importedById: user.id,
      },
    });

    // Row numbers are 1-based and exclude the header, so they line up with what
    // the user sees in Excel minus one — close enough to be useful in an error
    // report, and documented in the UI.
    await this.prisma.leadImportRow.createMany({
      data: rows.slice(1).map((cells, index) => ({
        batchId: batch.id,
        rowNumber: index + 1,
        raw: cells as never,
      })),
    });

    await this.audit.record({
      action: 'CREATE',
      resource: 'lead_import',
      resourceId: batch.id,
      changes: {
        reference,
        fileName: file.fileName,
        rows: rows.length - 1,
        origin: declaration.origin,
        suppliedBy: declaration.suppliedBy,
      },
    });

    return {
      batchId: batch.id,
      reference,
      fileName: file.fileName,
      totalRows: rows.length - 1,
      headers,
      suggestedMapping: suggestMapping(headers),
      sampleRows: rows.slice(1, 6),
    };
  }

  // -------------------------------------------------------------------------
  // Step 2 — validate against the confirmed mapping
  // -------------------------------------------------------------------------

  /**
   * Applies the mapping, validates every row, and checks each against the
   * existing book for duplicates.
   *
   * Deliberately shows problems before anything is written. A 500-row file from
   * a new joiner will contain mis-keyed mobiles and people SIHL already knows;
   * rejecting the whole file over one bad row is as unhelpful as silently
   * ingesting rubbish.
   */
  async validate(user: AuthenticatedPrincipal, batchId: string, mapping: ImportMapping) {
    const batch = await this.mustFindBatch(user, batchId);
    if (batch.status === 'COMMITTED') {
      throw new BadRequestException({
        title: 'Already imported',
        detail: 'This batch has been committed and cannot be re-validated.',
      });
    }

    const rows = await this.prisma.leadImportRow.findMany({
      where: { batchId },
      orderBy: { rowNumber: 'asc' },
    });

    // The candidate pool is loaded once. Matching every row against the whole
    // book with a query per row would be an N+1 that turns a 500-row import
    // into 500 round-trips.
    const candidates = await this.loadCandidatePool(rows, mapping);

    const previews: ImportRowPreview[] = [];
    let valid = 0;
    let invalid = 0;
    let duplicate = 0;

    // Mobiles seen earlier in this same file, so a file that repeats a person
    // does not import them twice.
    const seenInFile = new Map<string, number>();

    for (const row of rows) {
      const cells = row.raw as string[];
      const { mapped, errors } = this.mapAndValidate(cells, mapping);

      let status: 'VALID' | 'INVALID' | 'DUPLICATE' = 'VALID';
      let duplicateOf: ImportRowPreview['duplicateOf'] = null;
      let matchScore: number | null = null;
      let matchReasons: string[] = [];
      let duplicateLeadId: string | null = null;

      if (errors.length > 0) {
        status = 'INVALID';
        invalid += 1;
      } else {
        const mobile = mapped.mobile ?? null;

        const earlierRow = mobile ? seenInFile.get(mobile) : undefined;
        if (earlierRow !== undefined) {
          status = 'DUPLICATE';
          duplicate += 1;
          matchReasons = [`Row ${earlierRow} of this file has the same mobile number`];
          duplicateOf = {
            id: '',
            reference: `row ${earlierRow}`,
            fullName: `${mapped.firstName ?? ''} ${mapped.lastName ?? ''}`.trim(),
            ownerName: null,
            status: 'IN_THIS_FILE',
            confidence: 'DEFINITE',
            score: 100,
            reasons: matchReasons,
          };
        } else {
          if (mobile) seenInFile.set(mobile, row.rowNumber);

          const matches = findMatches(
            {
              firstName: mapped.firstName ?? '',
              lastName: mapped.lastName,
              mobile: mapped.mobile,
              email: mapped.email,
              pan: mapped.pan,
              city: mapped.city,
            },
            candidates,
            1,
          );

          const best = matches[0];
          if (best && (best.confidence === 'DEFINITE' || best.confidence === 'PROBABLE')) {
            status = 'DUPLICATE';
            duplicate += 1;
            duplicateLeadId = best.candidate.id;
            matchScore = best.score;
            matchReasons = best.signals.map((signal) => signal.label);
            duplicateOf = {
              id: best.candidate.id,
              reference: best.candidate.reference ?? '',
              fullName: `${best.candidate.firstName} ${best.candidate.lastName ?? ''}`.trim(),
              ownerName: best.candidate.ownerName ?? null,
              status: best.candidate.status ?? '',
              confidence: best.confidence,
              score: best.score,
              reasons: matchReasons,
            };
          } else {
            valid += 1;
          }
        }
      }

      await this.prisma.leadImportRow.update({
        where: { id: row.id },
        data: {
          status,
          mapped: mapped as never,
          errors: errors.length ? (errors as never) : undefined,
          duplicateOfLeadId: duplicateLeadId,
          matchScore,
          matchReasons: matchReasons.length ? (matchReasons as never) : undefined,
        },
      });

      previews.push({
        rowNumber: row.rowNumber,
        status,
        mapped: mapped as Record<string, string | null>,
        errors,
        duplicateOf,
        suggestedDecision:
          status === 'INVALID'
            ? 'SKIP'
            : status === 'DUPLICATE'
              ? suggestDecision(
                  duplicateOf
                    ? ({ confidence: duplicateOf.confidence } as never)
                    : undefined,
                )
              : 'CREATE',
      });
    }

    await this.prisma.leadImportBatch.update({
      where: { id: batchId },
      data: {
        status: 'VALIDATED',
        mapping: mapping as never,
        validRows: valid,
        invalidRows: invalid,
        duplicateRows: duplicate,
      },
    });

    return {
      batchId,
      totals: { total: rows.length, valid, invalid, duplicate },
      rows: previews,
    };
  }

  // -------------------------------------------------------------------------
  // Step 3 — commit
  // -------------------------------------------------------------------------

  /**
   * Creates leads for the rows the user chose to import.
   *
   * Duplicates default to SKIP, never MERGE. That is the approved ownership
   * policy: the incumbent lead and its owner win, and the import records that a
   * claim was made without moving the lead. Auto-merging would silently
   * transfer a colleague's lead to whoever imported most recently.
   */
  async commit(user: AuthenticatedPrincipal, batchId: string, input: CommitImportInput) {
    const batch = await this.mustFindBatch(user, batchId);

    if (batch.status !== 'VALIDATED') {
      throw new BadRequestException({
        title: 'Not ready to import',
        detail: 'Validate the mapping before importing.',
      });
    }
    if (!batch.mapping) {
      throw new BadRequestException({ title: 'No column mapping recorded' });
    }

    const mapping = batch.mapping as unknown as ImportMapping;
    const overrides = new Map(input.decisions.map((entry) => [entry.rowNumber, entry.decision]));

    const rows = await this.prisma.leadImportRow.findMany({
      where: { batchId, status: { in: ['VALID', 'DUPLICATE'] } },
      orderBy: { rowNumber: 'asc' },
    });

    let imported = 0;
    let skipped = 0;

    for (const row of rows) {
      const decision =
        overrides.get(row.rowNumber) ?? (row.status === 'DUPLICATE' ? 'SKIP' : 'CREATE');

      if (decision === 'SKIP') {
        skipped += 1;
        await this.prisma.leadImportRow.update({
          where: { id: row.id },
          data: { status: 'SKIPPED' },
        });
        continue;
      }

      try {
        const leadId = await this.createLeadFromRow(user, batch.id, row, mapping, {
          markMobileVerified: input.markMobileVerified,
          assignToUserId: input.assignToUserId,
        });
        imported += 1;
        await this.prisma.leadImportRow.update({
          where: { id: row.id },
          data: { status: 'IMPORTED', createdLeadId: leadId },
        });
      } catch (error) {
        // One bad row must not abort 499 good ones. The failure is recorded
        // against the row so the user can see exactly what happened and retry
        // just that row.
        skipped += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Import row ${row.rowNumber} of ${batch.reference} failed: ${message}`);
        await this.prisma.leadImportRow.update({
          where: { id: row.id },
          data: {
            status: 'INVALID',
            errors: [`Could not be imported: ${message}`] as never,
          },
        });
      }
    }

    const updated = await this.prisma.leadImportBatch.update({
      where: { id: batchId },
      data: {
        status: 'COMMITTED',
        importedRows: imported,
        skippedRows: skipped,
        committedAt: new Date(),
      },
    });

    await this.audit.record({
      action: 'CREATE',
      resource: 'lead_import.commit',
      resourceId: batchId,
      changes: { reference: batch.reference, imported, skipped },
    });

    await this.outbox.publish(this.prisma, {
      aggregateType: 'lead',
      aggregateId: batchId,
      eventType: 'lead.import.committed',
      payload: {
        reference: batch.reference,
        imported,
        skipped,
        importedBy: user.id,
        origin: batch.sourceOrigin,
        // Read by the notification router: it tells the batch owner their
        // leads have landed, and stays quiet when they imported them himself.
        assigneeId: input.assignToUserId ?? null,
        created: String(imported),
        actorId: user.id,
      },
    });

    return {
      batchId,
      reference: updated.reference,
      imported,
      skipped,
    };
  }

  async getBatch(user: AuthenticatedPrincipal, batchId: string) {
    const batch = await this.mustFindBatch(user, batchId);
    const rows = await this.prisma.leadImportRow.findMany({
      where: { batchId },
      orderBy: { rowNumber: 'asc' },
      take: 500,
    });

    return {
      id: batch.id,
      reference: batch.reference,
      fileName: batch.fileName,
      status: batch.status,
      totals: {
        total: batch.totalRows,
        valid: batch.validRows,
        invalid: batch.invalidRows,
        duplicate: batch.duplicateRows,
        imported: batch.importedRows,
        skipped: batch.skippedRows,
      },
      declaration: {
        origin: batch.sourceOrigin,
        suppliedBy: batch.suppliedBy,
        description: batch.sourceDescription,
        confirmedAt: batch.lawfulBasisConfirmedAt.toISOString(),
      },
      createdAt: batch.createdAt.toISOString(),
      committedAt: batch.committedAt?.toISOString() ?? null,
      rows: rows.map((row) => ({
        rowNumber: row.rowNumber,
        status: row.status,
        mapped: row.mapped,
        errors: row.errors ?? [],
        matchScore: row.matchScore,
        matchReasons: row.matchReasons ?? [],
        createdLeadId: row.createdLeadId,
      })),
    };
  }

  async listBatches(user: AuthenticatedPrincipal) {
    const batches = await this.prisma.leadImportBatch.findMany({
      where: user.dataScope === 'ALL' ? {} : { importedById: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { importedBy: { select: { firstName: true, lastName: true } } },
    });

    return batches.map((batch) => ({
      id: batch.id,
      reference: batch.reference,
      fileName: batch.fileName,
      status: batch.status,
      totalRows: batch.totalRows,
      importedRows: batch.importedRows,
      skippedRows: batch.skippedRows,
      origin: batch.sourceOrigin,
      suppliedBy: batch.suppliedBy,
      importedByName: batch.importedBy
        ? `${batch.importedBy.firstName} ${batch.importedBy.lastName}`.trim()
        : null,
      createdAt: batch.createdAt.toISOString(),
      committedAt: batch.committedAt?.toISOString() ?? null,
    }));
  }

  // -------------------------------------------------------------------------

  private mapAndValidate(
    cells: string[],
    mapping: ImportMapping,
  ): { mapped: Record<string, string | null>; errors: string[] } {
    const mapped: Record<string, string | null> = {};
    const errors: string[] = [];

    mapping.columns.forEach((field, index) => {
      if (!field) return;
      const value = (cells[index] ?? '').trim();
      if (value) mapped[field] = value;
    });

    // A single "name" column is extremely common; split it if no last name was
    // mapped separately.
    if (mapped.firstName && !mapped.lastName && mapped.firstName.includes(' ')) {
      const split = splitFullName(mapped.firstName);
      mapped.firstName = split.firstName;
      mapped.lastName = split.lastName;
    }

    if (!mapped.firstName) errors.push('Name is missing');

    if (!mapped.mobile) {
      errors.push('Mobile number is missing');
    } else {
      const parsed = indianMobileSchema.safeParse(mapped.mobile);
      if (parsed.success) {
        mapped.mobile = parsed.data;
      } else {
        errors.push(`Mobile "${mapped.mobile}" is not a valid Indian number`);
      }
    }

    if (mapped.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mapped.email)) {
      // A bad email does not stop the import — the phone number is what a
      // salesperson actually needs — so it is dropped with the row still valid.
      delete mapped.email;
    }

    if (mapped.pan) {
      const parsed = panSchema.safeParse(mapped.pan);
      if (parsed.success) mapped.pan = parsed.data;
      else delete mapped.pan;
    }

    if (mapped.pincode && !/^[1-9]\d{5}$/.test(mapped.pincode)) delete mapped.pincode;

    return { mapped, errors };
  }

  /**
   * Loads existing leads that could plausibly match anything in this file.
   *
   * Narrowed by the mobiles and PANs present in the file rather than loading
   * the whole book, plus leads sharing a surname for the fuzzy path. A full
   * table scan per import would not survive a real book.
   */
  private async loadCandidatePool(
    rows: Array<{ raw: unknown }>,
    mapping: ImportMapping,
  ): Promise<MatchCandidate[]> {
    const mobiles = new Set<string>();
    const pans = new Set<string>();
    const names = new Set<string>();

    for (const row of rows) {
      const cells = row.raw as string[];
      mapping.columns.forEach((field, index) => {
        const value = (cells[index] ?? '').trim();
        if (!value) return;
        if (field === 'mobile') {
          const digits = value.replace(/\D/g, '').slice(-10);
          if (digits.length === 10) mobiles.add(digits);
        } else if (field === 'pan') {
          pans.add(value.toUpperCase());
        } else if (field === 'firstName' || field === 'lastName') {
          for (const token of value.split(/\s+/)) {
            if (token.length >= 3) names.add(token.toLowerCase());
          }
        }
      });
    }

    const leads = await this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        OR: [
          { mobile: { in: [...mobiles] } },
          ...(pans.size ? [{ pan: { in: [...pans] } }] : []),
          ...(names.size
            ? [...names].slice(0, 40).map((token) => ({
                OR: [
                  { firstName: { contains: token, mode: 'insensitive' as const } },
                  { lastName: { contains: token, mode: 'insensitive' as const } },
                ],
              }))
            : []),
        ],
      },
      select: {
        id: true,
        reference: true,
        firstName: true,
        lastName: true,
        mobile: true,
        email: true,
        pan: true,
        city: true,
        status: true,
        owner: { select: { firstName: true, lastName: true } },
      },
      take: 5000,
    });

    return leads.map((lead) => ({
      id: lead.id,
      reference: lead.reference,
      firstName: lead.firstName,
      lastName: lead.lastName,
      mobile: lead.mobile,
      email: lead.email,
      pan: lead.pan,
      city: lead.city,
      status: lead.status,
      ownerName: lead.owner ? `${lead.owner.firstName} ${lead.owner.lastName}`.trim() : null,
    }));
  }

  private async createLeadFromRow(
    user: AuthenticatedPrincipal,
    batchId: string,
    row: { rowNumber: number; mapped: unknown },
    mapping: ImportMapping,
    options: { markMobileVerified: boolean; assignToUserId?: string },
  ): Promise<string> {
    const mapped = row.mapped as Record<string, string | undefined>;
    const productInterest = parseProductInterest(mapped.productInterest);
    const estimatedValue = parseImportedAmount(mapped.estimatedValue);

    // Routing goes through the same engine the website and events use.
    const routed = options.assignToUserId
      ? { ownerId: options.assignToUserId, ruleId: null }
      : mapping.ownerId
      ? { ownerId: mapping.ownerId, ruleId: null }
      : await this.assignment.resolveOwner({
          source: mapping.source,
          productInterest,
          city: mapped.city ?? null,
          state: mapped.state ?? null,
          campaignId: mapping.campaignId ?? null,
        });

    // The importer is the fallback owner: an imported lead nobody owns is a
    // lead nobody calls.
    const ownerId = routed.ownerId ?? user.id;
    const owner = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { orgUnitId: true },
    });

    const reference = await this.references.next('LD');

    const lead = await this.prisma.lead.create({
      data: {
        reference,
        firstName: mapped.firstName!,
        lastName: mapped.lastName ?? null,
        mobile: mapped.mobile!,
        email: mapped.email ?? null,
        pan: mapped.pan ?? null,
        city: mapped.city ?? null,
        state: mapped.state ?? null,
        pincode: mapped.pincode ?? null,
        source: mapping.source,
        productInterest,
        estimatedValue,
        ownerId,
        orgUnitId: owner?.orgUnitId ?? user.orgUnitId,
        campaignId: mapping.campaignId ?? null,
        importBatchId: batchId,
        // Only when the importer said so, and defaulting to unverified.
        //
        // Recorded as CALL because that is what "we already spoke to these"
        // means, and attributed to the person who ran the import — an
        // unattributed tick is worse than none, since the unverified rate is
        // the only measure of whether reps are actually reaching people.
        ...(options.markMobileVerified
          ? {
              mobileVerifiedAt: new Date(),
              mobileVerificationMethod: 'CALL' as const,
              mobileVerifiedById: user.id,
            }
          : {}),
        // The heart of the DPDP position: imported people have not agreed to
        // hear from SIHL. They can be called — that call is how consent is
        // obtained — but no marketing goes out until someone records it.
        consentStatus: 'PENDING',
        createdById: user.id,
        updatedById: user.id,
      },
    });

    const scored = scoreLead({
      source: mapping.source,
      productInterest,
      hasEmail: Boolean(mapped.email),
      hasPan: Boolean(mapped.pan),
      hasCity: Boolean(mapped.city),
      activityCount: 0,
      ageInDays: 0,
      daysSinceLastActivity: null,
      estimatedValue,
      hasCampaignAttribution: Boolean(mapping.campaignId),
    });

    await this.prisma.lead.update({
      where: { id: lead.id },
      data: { score: scored.score, scoreFactors: scored.factors as never, scoredAt: new Date() },
    });

    await this.prisma.leadStatusHistory.create({
      data: { leadId: lead.id, toStatus: 'NEW', changedById: user.id },
    });

    if (mapped.notes) {
      await this.prisma.activity.create({
        data: {
          entityType: 'LEAD',
          entityId: lead.id,
          type: 'NOTE',
          direction: 'INTERNAL',
          subject: 'Imported note',
          body: mapped.notes,
          actorId: user.id,
          isSystemGenerated: true,
        },
      });
    }

    return lead.id;
  }

  private async mustFindBatch(user: AuthenticatedPrincipal, batchId: string) {
    const batch = await this.prisma.leadImportBatch.findFirst({
      where: {
        id: batchId,
        // An importer sees their own batches; an unscoped user sees all.
        ...(user.dataScope === 'ALL' ? {} : { importedById: user.id }),
      },
    });
    if (!batch) throw new NotFoundException({ title: 'Import not found' });
    return batch;
  }
}
