import { Controller, Get, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  activityDetailQuerySchema,
  dailyActivityQuerySchema,
  reportRangeSchema,
  type ActivityDetailQuery,
  type DailyActivityQuery,
  type ReportRange,
} from '@sihl-one/contracts';

import { AuditService } from '../../common/audit.service';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import { istDayKey } from '../../common/ist-day';
import type { AuthenticatedPrincipal } from '../../common/types';
import { ZodValidationPipe } from '../../common/zod';
import { ReportsService } from './reports.service';
import { DailyActivityService } from './daily-activity.service';
import { WorkbookService } from './workbook.service';

/**
 * Sales reports.
 *
 * `analytics:sales:read` throughout, which every internal role already holds —
 * so a rep sees their own numbers, a manager their team's and the sales head
 * the whole book, from the same endpoints. The separation is done by data
 * scope, not by permission, which is why there is no manager-only variant here.
 */
@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly workbook: WorkbookService,
    private readonly dailyActivity: DailyActivityService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('analytics:sales:read')
  @ApiQuery({ name: 'from', required: false, description: 'ISO date. Defaults to 30 days ago.' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO date. Defaults to now.' })
  @ApiOperation({
    summary: 'The full sales report',
    description:
      'Summary plus the breakdowns by person, product, source, stage and branch, all over ' +
      'one shared window and all filtered to the caller’s data scope.',
  })
  full(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(reportRangeSchema)) range: ReportRange,
  ) {
    return this.reports.full(user, range);
  }

  @Get('daily')
  @RequirePermissions('analytics:sales:read')
  @ApiQuery({
    name: 'date',
    required: false,
    description: 'YYYY-MM-DD in IST. Defaults to yesterday.',
  })
  @ApiOperation({
    summary: 'What each person did on one day',
    description:
      'One row per person in the caller’s scope, including everyone with nothing ' +
      'recorded — the empty rows are the point. Grouped by branch with subtotals.',
  })
  daily(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(dailyActivityQuerySchema)) query: DailyActivityQuery,
  ) {
    return this.dailyActivity.report(user, query);
  }

  @Get('daily/detail')
  @RequirePermissions('analytics:sales:read')
  @ApiOperation({
    summary: 'The records behind one number on the daily report',
    description: 'Scope is re-checked here, not inherited from the report that linked to it.',
  })
  dailyDetail(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(activityDetailQuerySchema)) query: ActivityDetailQuery,
  ) {
    return this.dailyActivity.detail(user, query);
  }

  @Get('by-owner')
  @RequirePermissions('analytics:sales:read')
  @ApiOperation({ summary: 'Resource-wise: one row per person, plus unassigned' })
  byOwner(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(reportRangeSchema)) range: ReportRange,
  ) {
    return this.reports.byOwner(user, range);
  }

  @Get('by-product')
  @RequirePermissions('analytics:sales:read')
  @ApiOperation({
    summary: 'Product-wise, from per-product outcomes',
    description:
      'Counted from the per-product outcome table, so a lead that won equities and lost ' +
      'derivatives is recorded as both rather than rolled into one verdict.',
  })
  byProduct(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(reportRangeSchema)) range: ReportRange,
  ) {
    return this.reports.byProduct(user, range);
  }

  @Get('by-source')
  @RequirePermissions('analytics:sales:read')
  @ApiOperation({ summary: 'Where leads come from, and which sources actually convert' })
  bySource(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(reportRangeSchema)) range: ReportRange,
  ) {
    return this.reports.bySource(user, range);
  }

  @Get('by-branch')
  @RequirePermissions('analytics:sales:read')
  @ApiOperation({ summary: 'Branch-wise, with headcount for context' })
  byBranch(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(reportRangeSchema)) range: ReportRange,
  ) {
    return this.reports.byBranch(user, range);
  }

  /**
   * The single-file export.
   *
   * Available to anyone who can read the report, because the aggregate sheets
   * name employees and count things — they carry no client details. The
   * `Leads` sheet, which does, is written only when the caller also holds
   * `lead:export`; everyone else gets the same workbook with that sheet absent
   * and a line on the summary saying so.
   *
   * Recorded as an EXPORT in the audit trail either way. That is the action the
   * notice-period alert watches for, and a report of the whole book leaving the
   * system is exactly what it exists to catch.
   */
  @Get('export')
  @RequirePermissions('analytics:sales:read')
  @ApiOperation({ summary: 'Download the whole report as one Excel workbook' })
  async export(
    @CurrentUser() user: AuthenticatedPrincipal,
    @Query(new ZodValidationPipe(reportRangeSchema)) range: ReportRange,
    @Res() response: Response,
  ): Promise<void> {
    const includeLeadRows = user.permissions.includes('lead:export');
    const report = await this.reports.full(user, range);
    const buffer = await this.workbook.build(user, report, { includeLeadRows });

    await this.audit.record({
      action: 'EXPORT',
      resource: 'report',
      reason: includeLeadRows
        ? `Sales report with ${report.summary.leadsCreated} lead rows`
        : 'Sales report, aggregates only',
      changes: {
        from: report.summary.period.from,
        to: report.summary.period.to,
        includeLeadRows,
        scope: user.dataScope,
      },
    });

    const stamp = istDayKey(new Date());
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="sihl-sales-report-${stamp}.xlsx"`,
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    // Never cached: the contents depend on who asked, and a shared cache serving
    // one person's scoped book to another is a data-protection incident.
    response.setHeader('Cache-Control', 'private, no-store');
    response.end(buffer);
  }
}
