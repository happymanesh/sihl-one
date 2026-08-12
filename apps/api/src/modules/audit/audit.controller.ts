import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { auditQuerySchema, type AuditQuery } from '@sihl-one/contracts';
import { z } from 'zod';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedPrincipal } from '../../common/types';
import { ApiZodQuery, ZodQuery, ZodValidationPipe } from '../../common/zod';
import { AuditReadService } from './audit-read.service';

const daysSchema = z.coerce.number().int().min(1).max(90).default(7);
const resourceSchema = z.string().trim().min(1).max(60);
const resourceIdSchema = z.string().trim().min(1).max(64);

@ApiTags('Audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditReadService) {}

  @Get()
  @RequirePermissions('audit:read')
  @ApiOperation({
    summary: 'Search the audit trail',
    description:
      'Append-only. There is no write, update or delete path here by design. ' +
      'Reading the trail is itself recorded.',
  })
  @ApiZodQuery(auditQuerySchema)
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodQuery(auditQuerySchema) query: AuditQuery,
  ) {
    return this.audit.list(user, query);
  }

  @Get('summary')
  @RequirePermissions('audit:read')
  @ApiQuery({ name: 'days', required: false })
  @ApiOperation({ summary: 'Counts for the header strip over the last N days' })
  summary(@Query('days', new ZodValidationPipe(daysSchema)) days: number) {
    return this.audit.summary(days);
  }

  @Get(':resource/:resourceId')
  @RequirePermissions('audit:read')
  @ApiParam({ name: 'resource', description: 'e.g. lead, customer, user' })
  @ApiParam({ name: 'resourceId', description: 'The record id' })
  @ApiOperation({ summary: 'Everything that ever happened to one record' })
  forResource(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('resource', new ZodValidationPipe(resourceSchema)) resource: string,
    @Param('resourceId', new ZodValidationPipe(resourceIdSchema)) resourceId: string,
  ) {
    return this.audit.forResource(user, resource, resourceId);
  }
}
