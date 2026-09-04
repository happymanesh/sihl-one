import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { SalesReport } from '@sihl-one/contracts';

import { PrismaService } from '../../prisma/prisma.service';
import { ScopeService } from '../../common/scope.service';
import type { AuthenticatedPrincipal } from '../../common/types';

/**
 * The single-file export.
 *
 * One workbook, one sheet per breakdown, so the sales head gets the whole
 * picture in a file they can mail, pivot or paste into a review pack — rather
 * than six downloads they have to reassemble.
 *
 * The split that matters is between the aggregate sheets and the client rows.
 * Everyone who can see a report can export its aggregates: those are counts and
 * percentages, and they name employees, not clients. The `Leads` sheet carries
 * names, mobile numbers and emails, and is written only for a caller who
 * already holds `lead:export`. Without that separation, "let everyone export"
 * would quietly hand every sales executive a spreadsheet of the client book —
 * which is the single easiest way for a broker to lose one.
 */
@Injectable()
export class WorkbookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  private static readonly HEADER_FILL = 'FF0F2E5C';
  private static readonly MONEY = '#,##0.00';

  async build(
    user: AuthenticatedPrincipal,
    report: SalesReport,
    options: { includeLeadRows: boolean },
  ): Promise<Buffer> {
    const book = new ExcelJS.Workbook();
    book.creator = 'SIHL ONE';
    book.created = new Date();

    this.summarySheet(book, report, user, options.includeLeadRows);
    this.sheet(
      book,
      'By person',
      [
        { header: 'Employee code', key: 'employeeCode', width: 16 },
        { header: 'Name', key: 'ownerName', width: 26 },
        { header: 'Branch', key: 'branch', width: 20 },
        { header: 'Assigned', key: 'assigned', width: 11 },
        { header: 'Open', key: 'open', width: 9 },
        { header: 'Converted', key: 'converted', width: 12 },
        { header: 'Lost', key: 'lost', width: 9 },
        { header: 'Conversion %', key: 'conversionRate', width: 14 },
        { header: 'Activities', key: 'activities', width: 12 },
        { header: 'Visits', key: 'visits', width: 9 },
        { header: 'Overdue follow-ups', key: 'overdueFollowUps', width: 19 },
        { header: 'Pipeline (est.)', key: 'pipelineValue', width: 17, money: true },
      ],
      report.byOwner,
    );
    this.sheet(
      book,
      'By product',
      [
        { header: 'Product', key: 'productName', width: 26 },
        { header: 'Code', key: 'productCode', width: 14 },
        { header: 'Interested', key: 'interested', width: 12 },
        { header: 'Open', key: 'open', width: 9 },
        { header: 'Won', key: 'won', width: 9 },
        { header: 'Lost', key: 'lost', width: 9 },
        { header: 'Conversion %', key: 'conversionRate', width: 14 },
      ],
      report.byProduct,
    );
    this.sheet(
      book,
      'By source',
      [
        { header: 'Source', key: 'source', width: 24 },
        { header: 'Leads', key: 'leads', width: 10 },
        { header: 'Converted', key: 'converted', width: 12 },
        { header: 'Lost', key: 'lost', width: 9 },
        { header: 'Conversion %', key: 'conversionRate', width: 14 },
        { header: 'Value (est.)', key: 'pipelineValue', width: 17, money: true },
      ],
      report.bySource,
    );
    this.sheet(
      book,
      'By stage',
      [
        { header: 'Stage', key: 'status', width: 18 },
        { header: 'Leads', key: 'leads', width: 10 },
        { header: 'Share %', key: 'share', width: 10 },
      ],
      report.byStatus,
    );
    this.sheet(
      book,
      'By branch',
      [
        { header: 'Branch', key: 'branch', width: 26 },
        { header: 'People', key: 'people', width: 10 },
        { header: 'Leads', key: 'leads', width: 10 },
        { header: 'Converted', key: 'converted', width: 12 },
        { header: 'Conversion %', key: 'conversionRate', width: 14 },
        { header: 'Pipeline (est.)', key: 'pipelineValue', width: 17, money: true },
      ],
      report.byBranch,
    );

    if (options.includeLeadRows) await this.leadSheet(book, user, report);

    // exceljs types the return as the DOM ArrayBuffer rather than Node's Buffer.
    return Buffer.from(await book.xlsx.writeBuffer());
  }

  private summarySheet(
    book: ExcelJS.Workbook,
    report: SalesReport,
    user: AuthenticatedPrincipal,
    includedLeadRows: boolean,
  ): void {
    const sheet = book.addWorksheet('Summary');
    sheet.columns = [
      { key: 'label', width: 30 },
      { key: 'value', width: 26 },
    ];

    const title = sheet.addRow(['SIHL ONE — Sales report']);
    title.font = { bold: true, size: 15 };
    sheet.addRow([]);

    const { summary } = report;
    const rows: Array<[string, string | number | null]> = [
      ['Period from', istStamp(new Date(summary.period.from))],
      ['Period to', istStamp(new Date(summary.period.to))],
      ['Days covered', summary.period.days],
      ['Prepared for', `${user.fullName} <${user.email}>`],
      ['Data scope', user.dataScope],
      ['People in scope', summary.peopleInScope],
      ['Generated', istStamp(new Date())],
      ['', ''],
      ['Leads created', summary.leadsCreated],
      ['Leads converted', summary.leadsConverted],
      ['Leads lost', summary.leadsLost],
      ['Conversion %', summary.conversionRate],
      ['Open leads', summary.openLeads],
      ['Unassigned (open)', summary.unassigned],
      ['Overdue follow-ups', summary.overdueFollowUps],
      ['Activities logged', summary.activities],
      ['Visits checked in', summary.visits],
      ['Open pipeline (estimate)', Number(summary.pipelineValue)],
    ];
    for (const [label, value] of rows) {
      const row = sheet.addRow({ label, value });
      row.getCell('label').font = { bold: label !== '' };
      if (label === 'Open pipeline (estimate)') {
        row.getCell('value').numFmt = WorkbookService.MONEY;
      }
    }

    sheet.addRow([]);
    const note = sheet.addRow([
      'Every figure is filtered to the scope above, so two people running this ' +
        'report for the same period will legitimately see different numbers.',
    ]);
    note.font = { italic: true, size: 9 };
    const estimate = sheet.addRow([
      'Value figures are estimates entered by the team, not booked brokerage. ' +
        'This system records engagement; the back office remains the record of account.',
    ]);
    estimate.font = { italic: true, size: 9 };

    if (!includedLeadRows) {
      const omitted = sheet.addRow([
        'Individual client rows are not included: that requires the lead export permission.',
      ]);
      omitted.font = { italic: true, size: 9 };
    }
  }

  private sheet<T extends object>(
    book: ExcelJS.Workbook,
    name: string,
    columns: Array<{ header: string; key: string; width: number; money?: boolean }>,
    rows: readonly T[],
  ): void {
    const sheet = book.addWorksheet(name);
    sheet.columns = columns.map(({ header, key, width }) => ({ header, key, width }));

    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: WorkbookService.HEADER_FILL },
    };
    header.alignment = { vertical: 'middle' };

    for (const source of rows) {
      const row = source as Record<string, unknown>;
      const added = sheet.addRow(
        Object.fromEntries(
          columns.map(({ key, money }) => [
            key,
            // A rate of null means "no denominator", not zero — leave the cell
            // empty so a sorted column does not put those reps at the bottom as
            // though they had failed to convert anything.
            row[key] === null ? null : money ? Number(row[key]) : row[key],
          ]),
        ),
      );
      for (const column of columns) {
        if (column.money) added.getCell(column.key).numFmt = WorkbookService.MONEY;
      }
    }

    // Freeze the header and turn on filters: this is a workbook people sort and
    // slice, and a report you cannot sort gets rebuilt by hand in another file.
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    if (rows.length > 0) {
      sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
    }
  }

  /**
   * The client rows. Only reached when the caller holds `lead:export`, and
   * still filtered by their data scope on top of that.
   */
  private async leadSheet(
    book: ExcelJS.Workbook,
    user: AuthenticatedPrincipal,
    report: SalesReport,
  ): Promise<void> {
    const leads = await this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        AND: [this.scope.leadScope(user)],
        createdAt: {
          gte: new Date(report.summary.period.from),
          lte: new Date(report.summary.period.to),
        },
      },
      select: {
        reference: true,
        firstName: true,
        lastName: true,
        mobile: true,
        email: true,
        city: true,
        state: true,
        status: true,
        source: true,
        priority: true,
        score: true,
        estimatedValue: true,
        productInterest: true,
        createdAt: true,
        convertedAt: true,
        nextFollowUpAt: true,
        owner: { select: { firstName: true, lastName: true, employeeCode: true } },
        orgUnit: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      // A ceiling, so one click cannot try to stream the entire book into memory.
      take: 20_000,
    });

    this.sheet(
      book,
      'Leads',
      [
        { header: 'Reference', key: 'reference', width: 18 },
        { header: 'Name', key: 'name', width: 26 },
        { header: 'Mobile', key: 'mobile', width: 15 },
        { header: 'Email', key: 'email', width: 28 },
        { header: 'City', key: 'city', width: 16 },
        { header: 'State', key: 'state', width: 16 },
        { header: 'Stage', key: 'status', width: 14 },
        { header: 'Source', key: 'source', width: 18 },
        { header: 'Priority', key: 'priority', width: 11 },
        { header: 'Score', key: 'score', width: 9 },
        { header: 'Products', key: 'products', width: 26 },
        { header: 'Value (est.)', key: 'estimatedValue', width: 16, money: true },
        { header: 'Owner', key: 'owner', width: 24 },
        { header: 'Owner code', key: 'ownerCode', width: 14 },
        { header: 'Branch', key: 'branch', width: 20 },
        { header: 'Created', key: 'createdAt', width: 18 },
        { header: 'Converted', key: 'convertedAt', width: 18 },
        { header: 'Next follow-up', key: 'nextFollowUpAt', width: 18 },
      ],
      leads.map((lead) => ({
        reference: lead.reference,
        name: `${lead.firstName}${lead.lastName ? ` ${lead.lastName}` : ''}`,
        mobile: lead.mobile,
        email: lead.email ?? '',
        city: lead.city ?? '',
        state: lead.state ?? '',
        status: lead.status,
        source: lead.source,
        priority: lead.priority,
        score: lead.score,
        products: lead.productInterest.join(', '),
        estimatedValue: lead.estimatedValue ? Number(lead.estimatedValue) : 0,
        owner: lead.owner ? `${lead.owner.firstName} ${lead.owner.lastName}` : 'Unassigned',
        ownerCode: lead.owner?.employeeCode ?? '',
        branch: lead.orgUnit?.name ?? '',
        createdAt: istStamp(lead.createdAt),
        convertedAt: lead.convertedAt ? istStamp(lead.convertedAt) : '',
        nextFollowUpAt: lead.nextFollowUpAt ? istStamp(lead.nextFollowUpAt) : '',
      })),
    );
  }
}

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * `04-Sep-26 15:35`, in IST — the same stamp the rest of the app shows.
 *
 * Written as text rather than an Excel date on purpose: an Excel serial date
 * carries no timezone, so the server's UTC would silently render five and a
 * half hours early on every machine that opened the file.
 */
function istStamp(when: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(when);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const month = SHORT_MONTHS[Number(part('month')) - 1] ?? part('month');
  return `${part('day')}-${month}-${part('year')} ${part('hour')}:${part('minute')}`;
}
