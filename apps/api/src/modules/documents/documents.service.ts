import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AttachDocumentInput, DocumentListItem, UploadedFile } from '@sihl-one/contracts';

import { AuditService } from '../../common/audit.service';
import { ScopeService } from '../../common/scope.service';
import type { AuthenticatedPrincipal } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/**
 * Only files that have been positively confirmed clean may be downloaded.
 *
 * PENDING and FAILED both mean "we do not know", and treating "we do not know"
 * as safe is how a malicious upload reaches an employee's desktop. The file is
 * still stored and still listed — the gap is visible rather than hidden.
 */
const DOWNLOADABLE_SCAN_STATUSES = new Set(['CLEAN']);

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  async attach(
    user: AuthenticatedPrincipal,
    input: AttachDocumentInput,
    file: UploadedFile,
  ): Promise<DocumentListItem> {
    await this.assertParentVisible(user, input.entityType, input.entityId);

    // Same bytes uploaded twice against the same record: reuse the existing row
    // rather than creating a second one, and drop the duplicate object.
    const existing = await this.prisma.document.findFirst({
      where: {
        entityType: input.entityType,
        entityId: input.entityId,
        checksum: file.checksum,
        deletedAt: null,
      },
    });

    if (existing) {
      await this.storage.remove(file.storageKey);
      return this.toListItem(existing);
    }

    const document = await this.prisma.document.create({
      data: {
        entityType: input.entityType,
        entityId: input.entityId,
        fileName: file.fileName,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
        storageKey: file.storageKey,
        checksum: file.checksum,
        category: input.category,
        scanStatus: file.scanStatus,
        scanResult: file.scanStatus === 'CLEAN' ? null : 'Not confirmed clean',
        uploadedById: user.id,
      },
    });

    await this.prisma.activity.create({
      data: {
        entityType: input.entityType,
        entityId: input.entityId,
        type: 'DOCUMENT',
        direction: 'INTERNAL',
        subject: `Uploaded ${file.fileName}`,
        actorId: user.id,
        isSystemGenerated: true,
      },
    });

    await this.audit.record({
      action: 'CREATE',
      resource: 'document',
      resourceId: document.id,
      changes: {
        entityType: input.entityType,
        entityId: input.entityId,
        fileName: file.fileName,
        category: input.category,
        scanStatus: file.scanStatus,
      },
    });

    return this.toListItem(document);
  }

  async list(
    user: AuthenticatedPrincipal,
    entityType: string,
    entityId: string,
  ): Promise<DocumentListItem[]> {
    await this.assertParentVisible(user, entityType, entityId);

    const documents = await this.prisma.document.findMany({
      where: { entityType: entityType as never, entityId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    return documents.map((document) => this.toListItem(document));
  }

  /**
   * Issues a short-lived, user-bound download grant.
   *
   * Returns a token rather than streaming the file, so an `<img>` or a new tab
   * can fetch it without carrying the session — while the grant still expires
   * and still cannot be handed to someone else.
   */
  async grantDownload(user: AuthenticatedPrincipal, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, deletedAt: null },
    });
    if (!document) throw new NotFoundException({ title: 'Document not found' });

    await this.assertParentVisible(user, document.entityType, document.entityId);

    if (!DOWNLOADABLE_SCAN_STATUSES.has(document.scanStatus)) {
      throw new BadRequestException({
        title: 'File cannot be downloaded',
        detail:
          document.scanStatus === 'INFECTED'
            ? 'This file was identified as malicious.'
            : 'This file has not been confirmed free of malware, so it cannot be downloaded.',
      });
    }

    const { token, expiresAt } = this.storage.signDownload(document.storageKey, user.id);

    await this.audit.record({
      action: 'READ',
      resource: 'document',
      resourceId: document.id,
      changes: { fileName: document.fileName },
    });

    return {
      url: `/documents/${document.id}/content?token=${encodeURIComponent(token)}`,
      fileName: document.fileName,
      contentType: document.contentType,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async streamContent(user: AuthenticatedPrincipal, documentId: string, token: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, deletedAt: null },
    });
    if (!document) throw new NotFoundException({ title: 'Document not found' });

    if (!this.storage.verifyDownload(document.storageKey, user.id, token)) {
      throw new ForbiddenException({
        title: 'Download link is invalid or has expired',
        detail: 'Open the document again to get a fresh link.',
      });
    }

    if (!DOWNLOADABLE_SCAN_STATUSES.has(document.scanStatus)) {
      throw new BadRequestException({ title: 'File cannot be downloaded' });
    }

    return {
      body: await this.storage.read(document.storageKey),
      fileName: document.fileName,
      contentType: document.contentType,
    };
  }

  async remove(user: AuthenticatedPrincipal, documentId: string): Promise<void> {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, deletedAt: null },
    });
    if (!document) throw new NotFoundException({ title: 'Document not found' });

    await this.assertParentVisible(user, document.entityType, document.entityId);

    // Soft delete, and the object stays. A document attached to a client file
    // may be evidence; purging it belongs to the retention job, which knows the
    // regulatory minimum, not to whoever clicked delete.
    await this.prisma.document.update({
      where: { id: documentId },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      action: 'DELETE',
      resource: 'document',
      resourceId: documentId,
      changes: { fileName: document.fileName },
    });
  }

  private toListItem(document: {
    id: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    category: string | null;
    scanStatus: string;
    createdAt: Date;
  }): DocumentListItem {
    return {
      id: document.id,
      fileName: document.fileName,
      contentType: document.contentType,
      sizeBytes: document.sizeBytes,
      category: document.category,
      scanStatus: document.scanStatus,
      downloadable: DOWNLOADABLE_SCAN_STATUSES.has(document.scanStatus),
      uploadedAt: document.createdAt.toISOString(),
    };
  }

  /**
   * A document is visible only if its parent record is. Checking the parent
   * rather than the document is what stops a scoped user reading another RM's
   * client paperwork by guessing a document id.
   */
  private async assertParentVisible(
    user: AuthenticatedPrincipal,
    entityType: string,
    entityId: string,
  ): Promise<void> {
    let visible = false;

    switch (entityType) {
      case 'LEAD':
        visible = Boolean(
          await this.prisma.lead.findFirst({
            where: { id: entityId, deletedAt: null, AND: [this.scope.leadScope(user)] },
            select: { id: true },
          }),
        );
        break;
      case 'CUSTOMER':
        visible = Boolean(
          await this.prisma.customer.findFirst({
            where: { id: entityId, deletedAt: null, AND: [this.scope.customerScope(user)] },
            select: { id: true },
          }),
        );
        break;
      case 'PARTNER':
        visible = user.dataScope === 'ALL' || user.partnerId === entityId;
        break;
      default:
        visible = user.dataScope === 'ALL';
    }

    if (!visible) {
      throw new ForbiddenException({
        title: 'Record not accessible',
        detail: 'You cannot attach or read documents on a record outside your data scope.',
      });
    }
  }
}
