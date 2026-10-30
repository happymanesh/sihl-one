import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile as UploadedFileParam,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  createTrainingSchema,
  trainingQuerySchema,
  updateTrainingSchema,
  type CreateTrainingInput,
  type TrainingQuery,
  type UpdateTrainingInput,
} from '@sihl-one/contracts';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedPrincipal } from '../../common/types';
import { ApiZodBody, IdParamPipe, ZodBody, ZodValidationPipe } from '../../common/zod';
import { StorageService } from '../storage/storage.service';
import { TrainingService } from './training.service';

/** Matches the documents module: multer cuts an oversized body off early. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Training sessions, under Training & Test.
 *
 * Reading is open to anybody who can see the app — a session is announced to
 * the branches it is for, and hiding the list from the people expected to
 * attend would defeat it. Writing is `training:manage`.
 */
@ApiTags('Training')
@ApiBearerAuth()
@Controller('training')
export class TrainingController {
  constructor(
    private readonly training: TrainingService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Training sessions — upcoming by default' })
  list(@Query(new ZodValidationPipe(trainingQuerySchema)) query: TrainingQuery) {
    return this.training.list(query);
  }

  @Get(':id')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'One session, with its branches and material',
    description:
      '`editable` is computed here against the server clock, so a browser with a wrong clock ' +
      'cannot show an Edit button the API would refuse.',
  })
  findOne(@Param('id', IdParamPipe) id: string) {
    return this.training.findOne(id);
  }

  @Post()
  @RequirePermissions('training:manage')
  @ApiOperation({ summary: 'Schedule a training session' })
  @ApiZodBody(createTrainingSchema)
  create(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(createTrainingSchema) body: CreateTrainingInput,
  ) {
    return this.training.create(user, body);
  }

  @Patch(':id')
  @RequirePermissions('training:manage')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Edit a session, or cancel it',
    description: 'Refused once the session has finished — it is a record by then, not a plan.',
  })
  @ApiZodBody(updateTrainingSchema)
  update(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(updateTrainingSchema) body: UpdateTrainingInput,
  ) {
    return this.training.update(user, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('training:manage')
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Remove a session that has not run',
    description:
      'Only before it finishes. Afterwards there is nothing to delete — cancelling is how to ' +
      'say it did not happen, and the record stays.',
  })
  remove(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
  ): Promise<void> {
    return this.training.remove(user, id);
  }

  @Post(':id/material')
  @RequirePermissions('training:manage')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiParam({ name: 'id' })
  @ApiOperation({
    summary: 'Attach a presentation or handout',
    description:
      'The same store documents use: the declared type is checked against the file’s magic ' +
      'number and the bytes are scanned before anything is written.',
  })
  async addMaterial(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @UploadedFileParam()
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer } | undefined,
  ) {
    if (!file) {
      return { error: 'No file was supplied.' };
    }

    const stored = await this.storage.upload({
      fileName: file.originalname,
      contentType: file.mimetype,
      body: file.buffer,
      prefix: `training/${id}`,
    });

    return this.training.addMaterial(user, id, {
      fileName: stored.fileName,
      mimeType: stored.contentType,
      sizeBytes: stored.sizeBytes,
      storageKey: stored.storageKey,
    });
  }

  @Get(':id/material/:materialId')
  @ApiParam({ name: 'id' })
  @ApiParam({ name: 'materialId' })
  @ApiOperation({
    summary: 'Download attached material',
    description:
      'Stays available after the session has finished: re-reading what was presented is the ' +
      'commonest reason to open a past training at all.',
  })
  async download(
    @Param('id', IdParamPipe) id: string,
    @Param('materialId', IdParamPipe) materialId: string,
    @Res() response: Response,
  ): Promise<void> {
    const { key, name } = await this.training.materialKey(id, materialId);
    const body = await this.storage.read(key);

    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('Content-Disposition', `attachment; filename="${name.replace(/"/g, '')}"`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    response.end(body);
  }
}
