import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { misTeamQuerySchema, type MisTeamQuery } from '@sihl-one/contracts';
import type { Response } from 'express';

import { AuditService } from '../../common/audit.service';
import { RequirePermissions } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod';
import { MisService } from './mis.service';

@ApiTags('MIS')
@ApiBearerAuth()
@Controller('mis')
export class MisController {
  constructor(
    private readonly mis: MisService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The firm down the reporting line, for the one person who reads it that way.
   *
   * Unscoped on purpose. Every other report narrows to what the caller may
   * see; this one is the view from the top and would answer a different
   * question if it were trimmed. `mis:read` is therefore the whole of the
   * control, which is why it is granted to nobody by name.
   */
  @Get('team')
  @RequirePermissions('mis:read')
  @ApiQuery({ name: 'verticalHeadId', required: false })
  @ApiOperation({
    summary: 'Team performance down the reporting line',
    description:
      "One row per vertical head — the chief executive's direct reports — each carrying the " +
      'rollup of everyone beneath them, expandable to the whole line. Leads owned by the chief ' +
      'executive, owned by nobody, or owned outside the hierarchy are reported separately: each ' +
      'should be zero, and the totals would hide them otherwise.',
  })
  teamReport(@Query(new ZodValidationPipe(misTeamQuerySchema)) query: MisTeamQuery) {
    return this.mis.teamReport(query);
  }

  /**
   * The headline picture: this month against last, and the trends behind it.
   *
   * Its vertical comparison comes from the same rollup the tree does, so the
   * two screens cannot disagree about what a vertical is carrying.
   */
  @Get('overview')
  @RequirePermissions('mis:read')
  @ApiOperation({
    summary: 'Headline figures, week-on-week and month-on-month progress, and verticals compared',
  })
  overview() {
    return this.mis.overview();
  }

  /** The same report as a file, every level of the tree. */
  @Get('team/export')
  @RequirePermissions('mis:read')
  @ApiQuery({ name: 'verticalHeadId', required: false })
  @ApiOperation({ summary: 'Team performance as CSV, every level' })
  async teamExport(
    @Query(new ZodValidationPipe(misTeamQuerySchema)) query: MisTeamQuery,
    @Res() response: Response,
  ): Promise<void> {
    const { csv, asOn } = await this.mis.teamCsv(query);

    // Recorded like every other export. The file names every member of staff
    // and what they are carrying, which is exactly the kind of thing a
    // compliance reader asks about afterwards.
    await this.audit.record({
      action: 'EXPORT',
      resource: 'mis',
      reason: `Team performance exported as CSV, as on ${asOn}`,
      changes: { asOn, verticalHeadId: query.verticalHeadId ?? null },
    });

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="team-performance-${asOn}.csv"`,
    );
    // No byte-order mark added here: `toCsv` already writes one, and a second
    // is not invisible — it lands inside the first header cell, so Excel shows
    // a stray character where "Level" should be.
    response.send(csv);
  }
}
