import { Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  duplicateQuerySchema,
  mergeLeadsSchema,
  type DuplicateQuery,
  type MergeLeadsInput,
} from '@sihl-one/contracts';
import { z } from 'zod';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedPrincipal } from '../../common/types';
import { ApiZodBody, ApiZodQuery, ZodBody, ZodQuery, ZodValidationPipe } from '../../common/zod';
import { DuplicatesService } from './duplicates.service';

const idSchema = z.string().trim().min(8).max(64);

@ApiTags('Duplicates')
@ApiBearerAuth()
@Controller('duplicates')
export class DuplicatesController {
  constructor(private readonly duplicates: DuplicatesService) {}

  @Get()
  @RequirePermissions('lead:read')
  @ApiOperation({
    summary: 'Leads that share an identity key',
    description:
      'Grouped by exact mobile, email or PAN. Scoped — you only see groups whose leads are ' +
      'all within your data scope.',
  })
  @ApiZodQuery(duplicateQuerySchema)
  groups(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodQuery(duplicateQuerySchema) query: DuplicateQuery,
  ) {
    return this.duplicates.groups(user, query);
  }

  @Get('preview')
  @RequirePermissions('lead:update')
  @ApiQuery({ name: 'survivorId', required: true })
  @ApiQuery({ name: 'duplicateId', required: true })
  @ApiOperation({
    summary: 'What the surviving lead will look like afterwards',
    description: 'Computed by the same function the merge uses, so it cannot disagree with it.',
  })
  preview(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query('survivorId', new ZodValidationPipe(idSchema)) survivorId: string,
    @Query('duplicateId', new ZodValidationPipe(idSchema)) duplicateId: string,
  ) {
    return this.duplicates.preview(user, survivorId, duplicateId);
  }

  @Post('merge')
  @RequirePermissions('lead:update')
  @ApiOperation({
    summary: 'Merge two leads into one',
    description:
      'Nothing is deleted: the duplicate is closed and points at the survivor. History, ' +
      'documents and consent move across. A converted lead can only be the survivor.',
  })
  @ApiZodBody(mergeLeadsSchema)
  merge(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(mergeLeadsSchema) body: MergeLeadsInput,
  ) {
    return this.duplicates.merge(user, body);
  }
}
