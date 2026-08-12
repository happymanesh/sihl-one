import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { upsertTargetSchema, type UpsertTargetInput } from '@sihl-one/contracts';
import { z } from 'zod';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedPrincipal } from '../../common/types';
import { ApiZodBody, IdParamPipe, ZodBody, ZodValidationPipe } from '../../common/zod';
import { PerformanceService } from './performance.service';

const daysSchema = z.coerce.number().int().min(30).max(365).default(90);

@ApiTags('Performance')
@ApiBearerAuth()
@Controller('performance')
export class PerformanceController {
  constructor(private readonly performance: PerformanceService) {}

  @Get('me')
  @RequirePermissions('analytics:sales:read')
  @ApiQuery({ name: 'days', required: false })
  @ApiOperation({
    summary: 'Your own scorecard',
    description:
      'Quality-adjusted outcome, behaviour metrics, coaching actions, target pacing and a ' +
      'percentile band. Never a ranked list of colleagues.',
  })
  me(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query('days', new ZodValidationPipe(daysSchema)) days: number,
  ) {
    return this.performance.scorecard(user, user.id, days);
  }

  @Get('users/:id')
  @RequirePermissions('analytics:sales:read')
  @ApiQuery({ name: 'days', required: false })
  @ApiOperation({
    summary: 'A team member’s scorecard',
    description:
      'Restricted to yourself and people reporting to you. A rating is personnel ' +
      'information, not a leaderboard, so peers cannot read each other’s.',
  })
  forUser(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Param('id', IdParamPipe) id: string,
    @Query('days', new ZodValidationPipe(daysSchema)) days: number,
  ) {
    return this.performance.scorecard(user, id, days);
  }

  @Post('targets')
  @RequirePermissions('user:read')
  @ApiOperation({
    summary: 'Set or update a sales target',
    description: 'One target per person per period start; re-setting updates it in place.',
  })
  @ApiZodBody(upsertTargetSchema)
  setTarget(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(upsertTargetSchema) body: UpsertTargetInput,
  ) {
    return this.performance.upsertTarget(user, body);
  }
}
