import { Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  activityQuerySchema,
  createActivitySchema,
  type ActivityQuery,
  type CreateActivityInput,
} from '@sihl-one/contracts';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedPrincipal } from '../../common/types';
import { ApiZodBody, ApiZodQuery, ZodBody, ZodQuery } from '../../common/zod';
import { ActivitiesService } from './activities.service';

@ApiTags('Activities')
@ApiBearerAuth()
@Controller('activities')
export class ActivitiesController {
  constructor(private readonly activities: ActivitiesService) {}

  @Get()
  @RequirePermissions('activity:read')
  @ApiOperation({
    summary: 'Interaction timeline',
    description:
      'Scoped by the parent record. Without an entityId, a caller without full data scope ' +
      'sees only their own activity.',
  })
  @ApiZodQuery(activityQuerySchema)
  list(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodQuery(activityQuerySchema) query: ActivityQuery,
  ) {
    return this.activities.list(user, query);
  }

  @Post()
  @RequirePermissions('activity:create')
  @ApiOperation({
    summary: 'Log an interaction',
    description:
      'Updates the parent’s recency and, for leads, triggers a rescore. Backdating beyond ' +
      'the present is rejected.',
  })
  @ApiZodBody(createActivitySchema)
  create(@CurrentUser() user: AuthenticatedPrincipal, @ZodBody(createActivitySchema) body: CreateActivityInput) {
    return this.activities.create(user, body);
  }
}
