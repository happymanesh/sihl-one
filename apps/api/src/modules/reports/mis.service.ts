import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import {
  NO_VERTICAL_HEAD,
  istDayWindow,
  verticalHeadOf,
  type DailyActivityQuery,
  type DailyActivityRow,
} from '@sihl-one/contracts';

import { ScopeService } from '../../common/scope.service';
import type { AuthenticatedPrincipal } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { DailyActivityService } from './daily-activity.service';

/** Statuses that mean the lead is finished with, either way. */
const CLOSED = ['CONVERTED', 'LOST', 'DISQUALIFIED'] as const;

/**
 * The MIS Summary workbook.
 *
 * Three sheets, matching the template the business already circulates by
 * hand: a position summary per person, the activity behind it, and the lead
 * rows underneath. Built to that layout deliberately — a report that arrives
 * in the shape people already read is one they use on day one, and column
 * order is most of what makes a familiar sheet familiar.
 *
 * Two different kinds of number live in this file, and conflating them is the
 * easiest way to make it wrong:
 *
 *   - Sheet 1 and 3 are **as on** the chosen date: the book as it stands,
 *     counting everything up to the end of that day.
 *   - Sheet 2 is **on** that date: what each person actually did during it,
 *     which is the existing Daily Activity report.
 *
 * The template asks for both, so both are here, and each sheet says which it
 * is in its own title row.
 */
@Injectable()
export class MisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly dailyActivity: DailyActivityService,
  ) {}

  private static readonly HEADER_FILL = 'FF0F2E5C';

  async build(
    user: AuthenticatedPrincipal,
    query: DailyActivityQuery,
    options: { includeLeadRows: boolean },
  ): Promise<{ buffer: Buffer; day: string; people: number; leads: number }> {
    const activity = await this.dailyActivity.report(user, query);
    const day = activity.date;
    const { to } = istDayWindow(day);

    const book = new ExcelJS.Workbook();
    book.creator = 'SIHL ONE';
    book.created = new Date();

    const rows = activity.groups.flatMap((group) => group.rows);
    const staff = await this.staffDetail(rows.map((row) => row.userId));
    const position = await this.position(
      rows.map((row) => row.userId),
      to,
    );

    this.summarySheet(book, day, rows, staff, position);
    this.supportingSheet(book, day, rows, staff);

    const leads = options.includeLeadRows ? await this.leadSheet(book, user, to, staff) : 0;

    return {
      buffer: Buffer.from(await book.xlsx.writeBuffer()),
      day,
      people: rows.length,
      leads,
    };
  }

  /**
   * Sheet 1 — where each person's book stands at the end of the day.
   *
   * Not a day's work: "Total leads" is everything they hold, and "Pending" is
   * what is still open. A manager reading this wants the position; the
   * activity that produced it is the next sheet along.
   */
  private summarySheet(
    book: ExcelJS.Workbook,
    day: string,
    rows: Array<{ userId: string; fullName: string; employeeCode: string | null }>,
    staff: Map<string, StaffDetail>,
    position: Map<string, Position>,
  ): void {
    const sheet = this.sheet(book, 'Summary', `Position as on ${day}`, [
      { header: 'Sr No', key: 'sr', width: 7 },
      { header: 'Employee Code', key: 'employeeCode', width: 16 },
      { header: 'Employee Name', key: 'name', width: 26 },
      { header: 'Department', key: 'department', width: 20 },
      { header: 'Contact No', key: 'contact', width: 14 },
      { header: 'Reporting Head', key: 'reportingHead', width: 24 },
      { header: `Total Leads (as on ${day})`, key: 'total', width: 20 },
      { header: 'Total No of Contacted Leads', key: 'contacted', width: 24 },
      { header: 'Total No. Converted Leads', key: 'converted', width: 23 },
      { header: 'Lost Leads', key: 'lost', width: 12 },
      { header: `Pending as on ${day}`, key: 'pending', width: 19 },
    ]);

    rows.forEach((row, index) => {
      const detail = staff.get(row.userId);
      const held = position.get(row.userId) ?? EMPTY_POSITION;
      sheet.addRow({
        sr: index + 1,
        employeeCode: row.employeeCode ?? '',
        name: row.fullName,
        department: detail?.department ?? '',
        contact: detail?.mobile ?? '',
        reportingHead: detail?.manager ?? '',
        total: held.total,
        contacted: held.contacted,
        converted: held.converted,
        lost: held.lost,
        pending: held.pending,
      });
    });

    this.finish(sheet, rows.length, 11);
  }

  /** Sheet 2 — what each person did on the day. The existing daily figures. */
  private supportingSheet(
    book: ExcelJS.Workbook,
    day: string,
    rows: DailyActivityRow[],
    staff: Map<string, StaffDetail>,
  ): void {
    const sheet = this.sheet(book, 'Supporting Summary', `Activity on ${day}`, [
      { header: 'Sr.No', key: 'sr', width: 7 },
      { header: 'Employee Code', key: 'employeeCode', width: 16 },
      { header: 'Name', key: 'name', width: 26 },
      { header: 'Designation', key: 'designation', width: 22 },
      { header: 'Department', key: 'department', width: 20 },
      { header: 'Location', key: 'location', width: 20 },
      { header: 'Contact No', key: 'contact', width: 14 },
      { header: 'Reporting Manager', key: 'manager', width: 24 },
      { header: 'Open leads', key: 'openLeads', width: 12 },
      { header: 'Leads assigned', key: 'leadsAssigned', width: 15 },
      { header: 'Leads created', key: 'leadsCreated', width: 14 },
      { header: 'Mobiles verified', key: 'mobilesVerified', width: 16 },
      { header: 'Leads updated', key: 'leadsUpdated', width: 14 },
      { header: 'Visits done', key: 'visitsDone', width: 12 },
      { header: 'Joined visits', key: 'joinedVisits', width: 13 },
      { header: 'Converted', key: 'converted', width: 11 },
      { header: 'Lost', key: 'lost', width: 9 },
      { header: 'Total', key: 'total', width: 10 },
    ]);

    rows.forEach((row, index) => {
      const detail = staff.get(row.userId);
      sheet.addRow({
        sr: index + 1,
        employeeCode: row.employeeCode ?? '',
        name: row.fullName,
        designation: detail?.designation ?? '',
        department: detail?.department ?? '',
        location: row.branch ?? '',
        contact: detail?.mobile ?? '',
        manager: row.manager ?? '',
        openLeads: row.openLeads,
        leadsAssigned: row.leadsAssigned,
        leadsCreated: row.leadsCreated,
        mobilesVerified: row.mobilesVerified,
        leadsUpdated: row.leadsUpdated,
        visitsDone: row.visitsDone,
        joinedVisits: row.joinedVisits,
        converted: row.converted,
        lost: row.lost,
        total: row.total,
      });
    });

    this.finish(sheet, rows.length, 18);
  }

  /**
   * Sheet 3 — the lead rows, attributed to the person who owns them.
   *
   * Only built when the caller holds `lead:export`, and still cut to their
   * data scope on top of that. This sheet carries names, mobile numbers and
   * email addresses for real customers, so the grant that governs taking lead
   * data out of the system governs it here too.
   */
  private async leadSheet(
    book: ExcelJS.Workbook,
    user: AuthenticatedPrincipal,
    to: Date,
    staff: Map<string, StaffDetail>,
  ): Promise<number> {
    const leads = await this.prisma.lead.findMany({
      where: {
        deletedAt: null,
        AND: [this.scope.leadScope(user)],
        createdAt: { lte: to },
      },
      select: {
        id: true,
        reference: true,
        firstName: true,
        lastName: true,
        mobile: true,
        mobileVerifiedAt: true,
        email: true,
        city: true,
        status: true,
        source: true,
        priority: true,
        estimatedValue: true,
        createdAt: true,
        lastActivityAt: true,
        nextFollowUpAt: true,
        productInterest: true,
        ownerId: true,
        owner: { select: { firstName: true, lastName: true, employeeCode: true } },
        event: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      // A ceiling, because this is a spreadsheet somebody opens on a laptop.
      // Beyond this the right tool is the lead export with its own filters.
      take: 20_000,
    });

    const remarks = await this.remarks(leads.map((lead) => lead.id));

    const sheet = this.sheet(book, 'Lead Details', `Leads as on ${istDayKeyOf(to)}`, [
      { header: 'Sr No', key: 'sr', width: 7 },
      { header: 'Employee Code', key: 'employeeCode', width: 16 },
      { header: 'Employee Name', key: 'employeeName', width: 24 },
      { header: 'Reference Code', key: 'reference', width: 18 },
      { header: 'Lead Create Date', key: 'createdAt', width: 18 },
      { header: 'First name', key: 'firstName', width: 18 },
      { header: 'Last name', key: 'lastName', width: 18 },
      { header: 'Mobile', key: 'mobile', width: 14 },
      { header: 'Mobile verified', key: 'mobileVerified', width: 15 },
      { header: 'Email', key: 'email', width: 26 },
      { header: 'City', key: 'city', width: 16 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Source', key: 'source', width: 16 },
      { header: 'Priority', key: 'priority', width: 11 },
      { header: 'Products', key: 'products', width: 26 },
      { header: 'Estimated value', key: 'estimatedValue', width: 16 },
      { header: 'Event', key: 'event', width: 20 },
      { header: 'Last activity', key: 'lastActivity', width: 18 },
      { header: 'Next follow-up', key: 'nextFollowUp', width: 18 },
      { header: 'Remarks', key: 'remarks', width: 40 },
    ]);

    leads.forEach((lead, index) => {
      const detail = lead.ownerId ? staff.get(lead.ownerId) : undefined;
      sheet.addRow({
        sr: index + 1,
        // The owner's own code where the directory has it, falling back to
        // what the lead carries: a lead owned by somebody outside the people
        // on sheet 1 still belongs to a named person.
        employeeCode: detail?.employeeCode ?? lead.owner?.employeeCode ?? '',
        employeeName: lead.owner
          ? `${lead.owner.firstName} ${lead.owner.lastName}`.trim()
          : 'Unassigned',
        reference: lead.reference,
        createdAt: istStamp(lead.createdAt),
        firstName: lead.firstName,
        lastName: lead.lastName ?? '',
        mobile: lead.mobile ?? '',
        mobileVerified: lead.mobileVerifiedAt ? 'Yes' : 'No',
        email: lead.email ?? '',
        city: lead.city ?? '',
        status: lead.status,
        source: lead.source,
        priority: lead.priority,
        products: (lead.productInterest ?? []).join('; '),
        estimatedValue: lead.estimatedValue === null ? null : Number(lead.estimatedValue),
        event: lead.event?.name ?? '',
        lastActivity: istStamp(lead.lastActivityAt),
        nextFollowUp: istStamp(lead.nextFollowUpAt),
        remarks: remarks.get(lead.id) ?? '',
      });
    });

    this.finish(sheet, leads.length, 20);
    return leads.length;
  }

  /**
   * The remarks column, gathered from each lead's notes.
   *
   * A lead has no remarks field. What the business means by it is the notes
   * written against the lead — what a visitor typed, what the rep added after
   * a call — which are NOTE activities. One query for all of them rather than
   * one per lead, and capped, because a lead with two years of call notes can
   * otherwise produce a cell that breaks the file open in Excel.
   */
  private async remarks(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();

    const notes = await this.prisma.activity.findMany({
      where: { entityType: 'LEAD', entityId: { in: ids }, type: 'NOTE', body: { not: null } },
      orderBy: { occurredAt: 'desc' },
      select: { entityId: true, body: true },
      take: 80_000,
    });

    const MAX = 1000;
    const out = new Map<string, string>();
    for (const note of notes) {
      const existing = out.get(note.entityId);
      if (existing && existing.length >= MAX) continue;
      const line = (note.body ?? '').replace(/\s+/g, ' ').trim();
      if (!line) continue;
      const merged = existing ? `${existing} | ${line}` : line;
      out.set(note.entityId, merged.length > MAX ? `${merged.slice(0, MAX - 1)}…` : merged);
    }
    return out;
  }

  /**
   * Designation, department, mobile and manager, for everyone on the report.
   *
   * `department` has no column of its own in the data model. The nearest real
   * analogue SIHL ONE holds is the **vertical** — the National Head a
   * person's reporting line eventually reaches — so that is what fills it.
   *
   * Filling it from the designation instead was the first attempt and was
   * plainly wrong: it printed "National Head | National Head" across the
   * Designation and Department columns, which reads as a bug rather than as
   * information. The vertical is both true and different from the two columns
   * either side of it.
   *
   * The whole directory is read, not just the people on the report: walking a
   * reporting line needs the managers above them, who are frequently out of
   * the caller's scope.
   */
  private async staffDetail(ids: string[]): Promise<Map<string, StaffDetail>> {
    if (ids.length === 0) return new Map();

    const everyone = await this.prisma.user.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        mobile: true,
        employeeCode: true,
        managerId: true,
        designation: { select: { name: true, code: true } },
        orgUnit: { select: { name: true } },
        manager: { select: { firstName: true, lastName: true } },
      },
    });

    const lines = new Map(
      everyone.map((person) => [
        person.id,
        {
          managerId: person.managerId,
          designationCode: person.designation?.code ?? null,
          employeeCode: person.employeeCode,
        },
      ]),
    );
    const names = new Map(
      everyone.map((person) => [person.id, `${person.firstName} ${person.lastName}`.trim()]),
    );

    const wanted = new Set(ids);
    return new Map(
      everyone
        .filter((person) => wanted.has(person.id))
        .map((person) => {
          const head = verticalHeadOf(person.id, lines);
          return [
            person.id,
            {
              employeeCode: person.employeeCode,
              mobile: person.mobile,
              designation: person.designation?.name ?? null,
              department: head ? (names.get(head) ?? NO_VERTICAL_HEAD) : NO_VERTICAL_HEAD,
              manager: person.manager
                ? `${person.manager.firstName} ${person.manager.lastName}`.trim()
                : null,
              location: person.orgUnit?.name ?? null,
            },
          ];
        }),
    );
  }

  /**
   * Each person's book as at the end of the day.
   *
   * Grouped in one query over owner and status rather than counted per
   * person. `contacted`, `converted` and `lost` are current status, not
   * "ever reached" — so contacted counts those sitting at Contacted now, and
   * a lead that has moved on to Qualified is in `pending` instead.
   */
  private async position(ids: string[], to: Date): Promise<Map<string, Position>> {
    if (ids.length === 0) return new Map();

    const grouped = await this.prisma.lead.groupBy({
      by: ['ownerId', 'status'],
      where: { deletedAt: null, ownerId: { in: ids }, createdAt: { lte: to } },
      _count: true,
    });

    const out = new Map<string, Position>();
    for (const row of grouped) {
      if (!row.ownerId) continue;
      const held = out.get(row.ownerId) ?? { ...EMPTY_POSITION };
      const n = row._count;

      held.total += n;
      if (row.status === 'CONTACTED') held.contacted += n;
      if (row.status === 'CONVERTED') held.converted += n;
      if (row.status === 'LOST') held.lost += n;
      if (!CLOSED.includes(row.status as (typeof CLOSED)[number])) held.pending += n;

      out.set(row.ownerId, held);
    }
    return out;
  }

  /** A sheet with the house header, and a title row saying what it covers. */
  private sheet(
    book: ExcelJS.Workbook,
    name: string,
    subtitle: string,
    columns: Array<{ header: string; key: string; width: number }>,
  ): ExcelJS.Worksheet {
    const sheet = book.addWorksheet(name);

    /*
      Keys and widths only — deliberately no `header`.

      Assigning a header through `columns` makes exceljs write it into row 1,
      which would overwrite the title below and leave the file with two header
      rows and no title. The header is written by hand into row 2 instead.
    */
    sheet.columns = columns.map(({ key, width }) => ({ key, width }));

    // A title above the header, because three sheets covering two different
    // senses of "today" is exactly the sort of thing that gets mis-read once
    // the file has been forwarded twice.
    const title = sheet.getRow(1);
    title.values = [subtitle];
    title.font = { bold: true, size: 12 };

    const header = sheet.getRow(2);
    header.values = columns.map((column) => column.header);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: MisService.HEADER_FILL },
    };
    header.alignment = { vertical: 'middle', wrapText: true };

    return sheet;
  }

  /** Freeze the header and turn filters on, once the rows are in. */
  private finish(sheet: ExcelJS.Worksheet, rows: number, columns: number): void {
    sheet.views = [{ state: 'frozen', ySplit: 2 }];
    if (rows > 0) {
      sheet.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: columns } };
    }
  }
}

interface StaffDetail {
  employeeCode: string | null;
  mobile: string | null;
  designation: string | null;
  department: string | null;
  manager: string | null;
  location: string | null;
}

interface Position {
  total: number;
  contacted: number;
  converted: number;
  lost: number;
  pending: number;
}

const EMPTY_POSITION: Position = {
  total: 0,
  contacted: 0,
  converted: 0,
  lost: 0,
  pending: 0,
};

/** `YYYY-MM-DD` for an instant, read in IST. */
function istDayKeyOf(at: Date): string {
  return new Date(at.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * A timestamp as the business reads it.
 *
 * Written as text rather than a date cell on purpose: Excel renders a real
 * date in the opening machine's locale, which turns 03-10 into October 3rd on
 * one desk and March 10th on another. For a sheet that gets forwarded, a
 * fixed string is the only thing that means one date everywhere.
 */
function istStamp(at: Date | null): string {
  if (!at) return '';
  const ist = new Date(at.getTime() + 5.5 * 3_600_000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(ist.getUTCDate())}-${pad(ist.getUTCMonth() + 1)}-${ist.getUTCFullYear()} ${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}`;
}
