import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  commitImportSchema,
  importDeclarationSchema,
  importMappingSchema,
  type CommitImportInput,
  type ImportMapping,
} from '@sihl-one/contracts';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedPrincipal } from '../../common/types';
import { ApiZodBody, IdParamPipe, ZodBody, ZodValidationPipe } from '../../common/zod';
import { ImportsService } from './imports.service';

interface UploadedMultipartFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** 5 MB of text is far more than 5,000 rows of lead data. */
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

@ApiTags('Lead import')
@ApiBearerAuth()
@Controller('leads/import')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get()
  @RequirePermissions('lead:import')
  @ApiOperation({ summary: 'Recent import batches' })
  list(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.imports.listBatches(user);
  }

  @Get(':id')
  @RequirePermissions('lead:import')
  @ApiOperation({ summary: 'One import batch with its rows and provenance declaration' })
  getBatch(@CurrentUser() user: AuthenticatedPrincipal, @Param('id', IdParamPipe) id: string) {
    return this.imports.getBatch(user, id);
  }

  @Post('parse')
  @RequirePermissions('lead:import')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'origin', 'suppliedBy', 'description', 'lawfulBasisConfirmed'],
      properties: {
        file: { type: 'string', format: 'binary' },
        origin: { type: 'string' },
        suppliedBy: { type: 'string' },
        description: { type: 'string' },
        lawfulBasisConfirmed: { type: 'string', enum: ['true'] },
      },
    },
  })
  @ApiOperation({
    summary: 'Step 1 — upload a file and stage its rows',
    description:
      'Requires a provenance declaration. SIHL becomes the Data Fiduciary for this personal ' +
      'data on ingest, so who supplied it and on what basis is recorded before any row is ' +
      'staged. Returns a suggested column mapping for confirmation.',
  })
  async parse(
    @CurrentUser() user: AuthenticatedPrincipal,
    @UploadedFile() file: UploadedMultipartFile | undefined,
    @Query() query: Record<string, string>,
  ) {
    if (!file) throw new BadRequestException({ title: 'No file supplied' });

    // CSV, TSV and plain text are read directly. Excel is not parsed here —
    // asking the user to "Save as CSV" is one click and avoids a heavyweight
    // spreadsheet dependency plus its parsing quirks. Stated plainly in the UI.
    const name = file.originalname.toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      throw new BadRequestException({
        title: 'Save the spreadsheet as CSV first',
        detail:
          'In Excel choose File → Save As → CSV (Comma delimited), then upload that file. ' +
          'Direct .xlsx import is on the roadmap.',
      });
    }

    const declaration = new ZodValidationPipe(importDeclarationSchema).transform({
      origin: query.origin,
      suppliedBy: query.suppliedBy,
      description: query.description,
      lawfulBasisConfirmed: query.lawfulBasisConfirmed === 'true',
    }) as never;

    return this.imports.parse(
      user,
      { fileName: file.originalname, text: file.buffer.toString('utf8') },
      declaration,
    );
  }

  @Post(':id/validate')
  @RequirePermissions('lead:import')
  @ApiOperation({
    summary: 'Step 2 — apply the mapping and preview every row',
    description:
      'Validates each row and checks it against the existing book. Nothing is created. ' +
      'Duplicates are reported with the reasoning and the incumbent owner’s name.',
  })
  @ApiZodBody(importMappingSchema)
  validate(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(importMappingSchema) body: ImportMapping,
  ) {
    return this.imports.validate(user, id, body);
  }

  @Post(':id/commit')
  @RequirePermissions('lead:import')
  @ApiOperation({
    summary: 'Step 3 — create the leads',
    description:
      'Duplicates default to skip: the incumbent lead and its owner are retained, and the ' +
      'import records that a claim was made. A row that fails does not abort the batch.',
  })
  @ApiZodBody(commitImportSchema)
  commit(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @ZodBody(commitImportSchema) body: CommitImportInput,
  ) {
    return this.imports.commit(user, id, body);
  }
}
