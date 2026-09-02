import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { AllowServiceAccount, CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedPrincipal } from '../../common/types';
import { ZodValidationPipe } from '../../common/zod';
import { DashboardService } from './dashboard.service';

const daysSchema = z.coerce.number().int().min(7).max(365).default(30);
const limitSchema = z.coerce.number().int().min(1).max(20).default(5);

@ApiTags('Dashboard')
@ApiBearerAuth()
/**
 * Reachable with a service key as well as a user token.
 *
 * These three are the only endpoints a machine can reach today, and they are
 * the right first ones: all three are aggregates already filtered by the
 * caller's data scope, none returns a client name or a mobile number, and none
 * writes. A reporting integration asking "how is the book doing" gets an
 * answer without ever being handed a row of PII.
 */
@AllowServiceAccount()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('overview')
  @RequirePermissions('analytics:sales:read')
  @ApiOperation({
    summary: 'Headline metrics for the signed-in user',
    description:
      'Every figure is filtered to the caller’s data scope, so one endpoint serves an ' +
      'executive and a sales executive with different numbers.',
  })
  overview(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.dashboard.overview(user);
  }

  @Get('lead-trend')
  @RequirePermissions('analytics:sales:read')
  @ApiQuery({ name: 'days', required: false, schema: { type: 'integer', default: 30 } })
  @ApiOperation({ summary: 'Zero-filled daily lead creation and conversion series' })
  leadTrend(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query('days', new ZodValidationPipe(daysSchema)) days: number,
  ) {
    return this.dashboard.leadTrend(user, days);
  }

  @Get('top-performers')
  @RequirePermissions('analytics:sales:read')
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', default: 5 } })
  @ApiOperation({ summary: 'Conversions by relationship manager over the last 30 days' })
  topPerformers(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query('limit', new ZodValidationPipe(limitSchema)) limit: number,
  ) {
    return this.dashboard.topPerformers(user, limit);
  }
}
