import type { PerformanceReport } from '@sihl-one/contracts';

/**
 * The report as plain text, for the email body.
 *
 * Built from the same object the page renders, so the message cannot drift
 * from the screen it was sent off. Plain text rather than a rendered table: it
 * has to survive a phone mail client and a forward, and a report nobody can
 * read on a phone is one nobody reads.
 *
 * Shared by the single-scope screen and the per-vertical batch. It lived
 * inside the performance page until the batch needed it too, and two copies of
 * a format people learn to read is two formats that quietly diverge.
 */
export function asEmailBody(report: PerformanceReport): string {
  const lines: string[] = [
    `${report.scopeLabel} — ${report.period.label}`,
    '',
    ...report.summary,
    '',
    'Totals',
    `  Leads            ${report.totals.totalLeads}`,
    `  Open             ${report.totals.openLeads}`,
    `  Converted        ${report.totals.converted}`,
    `  Lost             ${report.totals.lost}`,
    `  Conversion       ${report.totals.conversionRate ?? 0}%`,
    `  Never contacted  ${report.totals.unattendedEver}`,
    `  No contact 2d+   ${report.totals.unattendedTwoDays}`,
    `  Holding nothing  ${report.totals.resourcesWithoutLeads} of ${report.totals.resourceCount}`,
    '',
    'By person',
  ];

  for (const row of report.rows) {
    lines.push(
      `  ${row.fullName}${row.employeeCode ? ` (${row.employeeCode})` : ''} — ` +
        `${row.totalLeads} leads, ${row.converted} converted, ${row.conversionRate ?? 0}%` +
        `${row.unattendedEver > 0 ? `, ${row.unattendedEver} never contacted` : ''}` +
        `${row.overallScore !== null ? `, score ${row.overallScore}` : ''}`,
    );
  }

  lines.push('', 'Generated from SIHL ONE.');
  return lines.join('\n');
}

/** The subject line, matching the body's first line. */
export function asEmailSubject(report: PerformanceReport): string {
  return `Performance — ${report.scopeLabel}, ${report.period.label}`;
}
