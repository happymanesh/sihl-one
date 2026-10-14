import type {
  PerformancePeriodKind,
  PerformanceReport,
  PerformanceScope,
} from '@sihl-one/contracts';

import { Badge } from '@/components/ui/Badge';
import { EmailReportDialog } from '@/components/performance/EmailReportDialog';
import { PerformanceFilters } from '@/components/performance/PerformanceFilters';
import { apiFetch } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { formatNumber } from '@/lib/format';

export const metadata = { title: 'Performance' };

const BAND_TONE: Record<string, 'teal' | 'green' | 'blue' | 'amber'> = {
  EXCEPTIONAL: 'green',
  STRONG: 'teal',
  ON_TRACK: 'blue',
  DEVELOPING: 'amber',
};

/**
 * One number, with the thing it is about underneath it.
 *
 * `tone` marks the two that are bad when they are high — unattended work and
 * people holding nothing — so a reader's eye lands on them without having to
 * know which way is good for each column.
 */
function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: 'warn';
}) {
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </p>
      <p
        className={`mt-1 text-2xl font-bold tnum ${
          tone === 'warn' && value !== '0' ? 'text-[var(--color-warn-strong)]' : ''
        }`}
      >
        {value}
      </p>
      {note ? <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">{note}</p> : null}
    </div>
  );
}

/**
 * The report as plain text, for the email body.
 *
 * Built on the server from the same object the page renders, so the message
 * cannot drift from the screen it was sent off. Plain text rather than a
 * rendered table: it has to survive a phone mail client and a forward, and a
 * report nobody can read on a phone is one nobody reads.
 */
function asEmailBody(report: PerformanceReport): string {
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

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireUser();
  const params = await searchParams;

  const scope = (params.scope as PerformanceScope) ?? 'TEAM';
  const period = (params.period as PerformancePeriodKind) ?? 'AS_ON_DATE';
  const designationId = params.designationId ?? '';
  const userId = params.userId ?? '';
  const orgUnitId = params.orgUnitId ?? '';

  const query = new URLSearchParams({ scope, period });
  if (designationId) query.set('designationId', designationId);
  if (userId) query.set('userId', userId);
  if (orgUnitId) query.set('orgUnitId', orgUnitId);

  const [report, designations, orgUnits] = await Promise.all([
    apiFetch<PerformanceReport>(`/performance/report?${query.toString()}`),
    // Empty lists narrow the filters rather than failing the page: a report
    // that will not load because a dropdown could not be filled is worse than
    // one with fewer ways to slice it.
    apiFetch<Array<{ id: string; name: string }>>('/admin/designations').catch(() => []),
    apiFetch<Array<{ id: string; name: string; type: string }>>('/org-units').catch(() => []),
  ]);

  const emailBody = asEmailBody(report);
  const subject = `Performance — ${report.scopeLabel}, ${report.period.label}`;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Performance</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {report.scopeLabel} · {report.period.label} ·{' '}
            {formatNumber(report.totals.resourceCount)}{' '}
            {report.totals.resourceCount === 1 ? 'person' : 'people'}
          </p>
        </div>
      </header>

      <PerformanceFilters
        scope={scope}
        period={period}
        designationId={designationId}
        userId={userId}
        orgUnitId={orgUnitId}
        designations={designations}
        orgUnits={orgUnits}
        people={report.rows.map((row) => ({ userId: row.userId, fullName: row.fullName }))}
      />

      {/* What the group's position is, in sentences. A score nobody can
          interrogate gets argued with rather than acted on. */}
      {report.summary.length > 0 ? (
        <section className="card p-4">
          <h2 className="text-sm font-bold">Where this stands</h2>
          <ul className="mt-2 space-y-1 text-sm text-[var(--color-text-muted)]">
            {report.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total leads" value={formatNumber(report.totals.totalLeads)} />
        <Stat label="Open" value={formatNumber(report.totals.openLeads)} />
        <Stat
          label="Conversion"
          value={`${report.totals.conversionRate ?? 0}%`}
          note={
            report.progress?.conversionRateDelta != null
              ? `${report.progress.conversionRateDelta >= 0 ? '+' : ''}${report.progress.conversionRateDelta} pts vs ${report.progress.previousLabel}`
              : undefined
          }
        />
        <Stat label="Converted" value={formatNumber(report.totals.converted)} />
        <Stat
          label="Never contacted"
          value={formatNumber(report.totals.unattendedEver)}
          note="No interaction since the lead was created"
          tone="warn"
        />
        <Stat
          label="No contact 2 days+"
          value={formatNumber(report.totals.unattendedTwoDays)}
          note="Slipping, not yet lost"
          tone="warn"
        />
        <Stat
          label="Holding no leads"
          value={`${formatNumber(report.totals.resourcesWithoutLeads)} of ${formatNumber(report.totals.resourceCount)}`}
          tone="warn"
        />
        <Stat
          label="Leads vs previous"
          value={
            report.progress?.totalLeadsDeltaPercent != null
              ? `${report.progress.totalLeadsDeltaPercent >= 0 ? '+' : ''}${report.progress.totalLeadsDeltaPercent}%`
              : '—'
          }
          note={report.progress ? `vs ${report.progress.previousLabel}` : undefined}
        />
      </div>

      <section className="card p-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                {[
                  'Person',
                  'Leads',
                  'Open',
                  'Converted',
                  'Conversion',
                  'Never contacted',
                  'No contact 2d+',
                  'Score',
                ].map((header) => (
                  <th
                    key={header}
                    scope="col"
                    className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr
                  key={row.userId}
                  className="border-b border-[var(--color-border)] last:border-0"
                >
                  <td className="px-3 py-2.5 align-top">
                    <span className="font-semibold">{row.fullName}</span>
                    <span className="block text-xs text-[var(--color-text-subtle)]">
                      {[row.employeeCode, row.designation, row.branch].filter(Boolean).join(' · ')}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 align-top tnum">{formatNumber(row.totalLeads)}</td>
                  <td className="px-3 py-2.5 align-top tnum">{formatNumber(row.openLeads)}</td>
                  <td className="px-3 py-2.5 align-top tnum">{formatNumber(row.converted)}</td>
                  <td className="px-3 py-2.5 align-top tnum">
                    {row.conversionRate === null ? '—' : `${row.conversionRate}%`}
                  </td>
                  <td
                    className={`px-3 py-2.5 align-top tnum ${
                      row.unattendedEver > 0 ? 'font-semibold text-[var(--color-warn-strong)]' : ''
                    }`}
                  >
                    {formatNumber(row.unattendedEver)}
                  </td>
                  <td className="px-3 py-2.5 align-top tnum">
                    {formatNumber(row.unattendedTwoDays)}
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    {/* No score rather than a low one where there is too
                        little to judge: a number from four leads reads as a
                        verdict on a person and is not one. */}
                    {row.overallScore === null ? (
                      <span
                        className="text-xs text-[var(--color-text-subtle)]"
                        title="Too few leads in this period to rate"
                      >
                        Not rated
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="tnum font-semibold">{row.overallScore}</span>
                        {row.scoreBand ? (
                          <Badge tone={BAND_TONE[row.scoreBand] ?? 'blue'}>
                            {row.scoreBand.replace('_', ' ').toLowerCase()}
                          </Badge>
                        ) : null}
                      </span>
                    )}
                    {row.scoreExplanation.length > 0 ? (
                      <span className="mt-1 block text-xs text-[var(--color-text-subtle)]">
                        {row.scoreExplanation[0]}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}

              {report.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-3 py-6 text-center text-sm text-[var(--color-text-muted)]"
                  >
                    Nobody in this selection.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {/*
        Only for a team.

        A region or a branch is a place, and "email this to the branch" has no
        obvious recipient list — a team is a set of people, so the report is
        already addressed to somebody.
      */}
      {scope === 'TEAM' && report.rows.length > 0 ? (
        <div className="flex justify-end">
          <EmailReportDialog
            subject={subject}
            body={emailBody}
            recipients={report.rows.map((row) => ({ fullName: row.fullName, email: row.email }))}
          />
        </div>
      ) : null}
    </div>
  );
}
