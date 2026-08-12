import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UploadedFile as UploadedFileParam,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  attachDocumentSchema,
  documentQuerySchema,
  MAX_UPLOAD_BYTES,
  type DocumentQuery,
} from '@sihl-one/contracts';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedPrincipal } from '../../common/types';
import { ApiZodQuery, IdParamPipe, ZodQuery, ZodValidationPipe } from '../../common/zod';
import { StorageService } from '../storage/storage.service';
import { DocumentsService } from './documents.service';

/** Express.Multer.File without requiring the multer type package globally. */
interface UploadedMultipartFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@ApiTags('Documents')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly storage: StorageService,
  ) {}

  @Post()
  @RequirePermissions('customer:read')
  // Uploads are expensive and are a classic amplification target, so they get a
  // tighter limit than ordinary reads.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      // Enforced by multer before the whole body is buffered. The per-type
      // limit in StorageService is finer-grained; this one exists so an
      // oversized upload is cut off early rather than read into memory first.
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'entityType', 'entityId'],
      properties: {
        file: { type: 'string', format: 'binary' },
        entityType: { type: 'string', enum: ['LEAD', 'CUSTOMER', 'PARTNER', 'OPPORTUNITY'] },
        entityId: { type: 'string' },
        category: { type: 'string' },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload a document against a lead, customer or partner',
    description:
      'Validates the declared type against the file’s magic number, enforces a per-type size ' +
      'limit, scans the bytes, then stores them under an opaque generated key. A file that ' +
      'fails any check is never persisted.',
  })
  async upload(
    @CurrentUser() user: AuthenticatedPrincipal,
    @UploadedFileParam() file: UploadedMultipartFile | undefined,
    @Query() query: Record<string, string>,
  ) {
    if (!file) {
      return { error: 'No file was supplied.' };
    }

    // Multipart form fields arrive as strings, so they are parsed with the same
    // Zod schema the JSON endpoints use rather than trusted as-is.
    const metadata = new ZodValidationPipe(attachDocumentSchema.omit({ storageKey: true })).transform(
      {
        entityType: query.entityType,
        entityId: query.entityId,
        category: query.category ?? 'OTHER',
      },
    ) as { entityType: 'LEAD' | 'CUSTOMER' | 'PARTNER' | 'OPPORTUNITY'; entityId: string; category: never };

    const stored = await this.storage.upload({
      fileName: file.originalname,
      contentType: file.mimetype,
      body: file.buffer,
      prefix: `documents/${metadata.entityType.toLowerCase()}`,
    });

    return this.documents.attach(user, { ...metadata, storageKey: stored.storageKey }, stored);
  }

  @Get()
  @RequirePermissions('customer:read')
  @ApiOperation({ summary: 'List documents attached to a record' })
  @ApiZodQuery(documentQuerySchema)
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodQuery(documentQuerySchema) query: DocumentQuery,
  ) {
    return this.documents.list(user, query.entityType, query.entityId);
  }

  @Get(':id/download')
  @RequirePermissions('customer:read')
  @ApiOperation({
    summary: 'Get a short-lived, user-bound download link',
    description: 'Only files confirmed free of malware can be downloaded.',
  })
  grantDownload(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
  ) {
    return this.documents.grantDownload(user, id);
  }

  @Get(':id/content')
  @RequirePermissions('customer:read')
  @ApiOperation({ summary: 'Fetch document bytes using a signed token' })
  async content(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @Query('token') token: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.documents.streamContent(user, id, token ?? '');

    response.setHeader('Content-Type', file.contentType);
    // `attachment` and nosniff together: a stored file must never be rendered
    // as a document in our own origin, which would turn an upload into stored
    // XSS regardless of the type allow-list.
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(file.fileName)}"`,
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    response.send(file.body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('customer:update')
  @ApiOperation({ summary: 'Soft-delete a document' })
  remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
  ): Promise<void> {
    return this.documents.remove(user, id);
  }
}
