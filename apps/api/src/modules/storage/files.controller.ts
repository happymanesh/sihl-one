import {
  BadRequestException,
  Controller,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { MAX_UPLOAD_BYTES } from '@sihl-one/contracts';
import { z } from 'zod';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedPrincipal } from '../../common/types';
import { ZodValidationPipe } from '../../common/zod';
import { StorageService } from './storage.service';

interface UploadedMultipartFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Purpose determines the storage prefix, and the prefix is chosen from this
 * fixed map rather than taken from the request — a caller-supplied path segment
 * is a directory-traversal primitive waiting to happen.
 */
const PURPOSE_PREFIXES: Record<string, string> = {
  VISIT_PHOTO: 'visits/photos',
  VOICE_NOTE: 'visits/voice',
};

const purposeSchema = z.enum(['VISIT_PHOTO', 'VOICE_NOTE']);

/**
 * Standalone file upload.
 *
 * Returns an opaque storage key rather than creating a document row, for files
 * that belong to a record that does not exist yet — a check-in photo is taken
 * before the check-in is submitted. The key is worthless on its own: it is
 * accepted only by an endpoint that re-checks the caller's rights, and reading
 * the object back always requires a signed, user-bound, expiring grant.
 */
@ApiTags('Files')
@ApiBearerAuth()
@Controller('files')
export class FilesController {
  constructor(private readonly storage: StorageService) {}

  @Post()
  @RequirePermissions('visit:create')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiQuery({ name: 'purpose', enum: ['VISIT_PHOTO', 'VOICE_NOTE'] })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'Upload a file and receive its storage key',
    description:
      'For files captured before the record that owns them exists — a visit check-in photo, ' +
      'or a voice note. Subject to the same type, magic-number, size and scan checks as a ' +
      'document upload.',
  })
  async upload(
    @CurrentUser() user: AuthenticatedPrincipal,
    @UploadedFile() file: UploadedMultipartFile | undefined,
    @Query('purpose', new ZodValidationPipe(purposeSchema)) purpose: string,
  ) {
    if (!file) {
      throw new BadRequestException({ title: 'No file supplied' });
    }

    const stored = await this.storage.upload({
      fileName: file.originalname,
      contentType: file.mimetype,
      body: file.buffer,
      // Namespaced per user so one person's uploads cannot be enumerated from
      // another's key, even though the keys are already random.
      prefix: `${PURPOSE_PREFIXES[purpose]}/${user.id}`,
    });

    return {
      storageKey: stored.storageKey,
      fileName: stored.fileName,
      contentType: stored.contentType,
      sizeBytes: stored.sizeBytes,
      scanStatus: stored.scanStatus,
    };
  }
}
