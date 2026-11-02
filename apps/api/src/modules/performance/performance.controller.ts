import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  performanceReportQuerySchema,
  sendPerformanceReportSchema,
  upsertTargetSchema,
  type PerformanceReportQuery,
  type SendPerformanceReportInput,
  type UpsertTargetInput,
} from '@sihl-one/contracts';
import { z } from 'zod';

import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AuthenticatedPrincipal } from '../../common/types';
import { ApiZodBody, IdParamPipe, ZodBody, ZodValidationPipe } from '../../common/zod';
import { PerformanceReportService } from './performance-report.service';
import { PerformanceService } from './performance.service';

const daysSchema = z.coerce.number().int().min(30).max(365).default(90);

@ApiTags('Performance')
@ApiBearerAuth()
@Controller('performance')
export class PerformanceController {
  constructor(
    private readonly performance: PerformanceService,
    private readonly report: PerformanceReportService,
  ) {}

  /**
   * How a team, a region or a branch is doing.
   *
   * Separate from `me` and `users/:id`, which are one person's scorecard and
   * are deliberately not a leaderboard. This is the manager's view of a group
   * they are accountable for, and it is scoped to what they can already see.
   */
  @Get('verticals')
  @RequirePermissions('analytics:sales:read')
  @ApiOperation({
    summary: 'The National Heads who own a vertical, with how many roll up to each',
    description:
      'Only heads with somebody reporting into them: one nobody reports to owns no vertical, ' +
      'and offering them gives an empty report and a puzzled reader.',
  })
  verticals() {
    return this.report.verticals();
  }

  @Get('report/verticals')
  @RequirePermissions('analytics:sales:read')
  @ApiOperation({
    summary: 'One report per vertical head, for the daily round of emails',
    description:
      'Every report in the batch shares one anchor date, so a set of emails cannot disagree ' +
      'about which day it covers. Sends nothing — this is what would be sent.',
  })
  reportPerVertical(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(performanceReportQuerySchema)) query: PerformanceReportQuery,
  ) {
    return this.report.reportPerVertical(user, query);
  }

  @Get('report')
  @RequirePermissions('analytics:sales:read')
  @ApiOperation({ summary: 'Performance across a team, region or branch' })
  reportFor(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(performanceReportQuerySchema)) query: PerformanceReportQuery,
  ) {
    return this.report.report(user, query);
  }

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

  /**
   * Mail a report to the people in it.
   *
   * The body is what the sender previewed, not something rebuilt here: a
   * server that re-rendered it could send something other than what was
   * approved on screen, which is the one thing a preview must rule out.
   *
   * Audited as an EXPORT. A team's performance leaving the system by email is
   * the same event as it leaving by download, and the notice-period alert
   * watches for exactly that.
   */
  @Post('report/send')
  @RequirePermissions('report:send')
  @ApiOperation({
    summary: 'Email a performance report that has been previewed',
    description:
      'Every address in `to` and `cc` must belong to an active internal SIHL user; anything ' +
      'else is refused and named in the reply. The report goes to colleagues or it does not go.',
  })
  @ApiZodBody(sendPerformanceReportSchema)
  sendReport(
    @CurrentUser() user: AuthenticatedPrincipal,
    @ZodBody(sendPerformanceReportSchema) body: SendPerformanceReportInput,
  ) {
    return this.report.send(user, body);
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
