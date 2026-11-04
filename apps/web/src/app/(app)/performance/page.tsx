import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Route } from 'next';
import type {
  PerformancePeriodKind,
  PerformanceReport,
  PerformanceScope,
} from '@sihl-one/contracts';

import { Badge } from '@/components/ui/Badge';
import { EmailReportDialog } from '@/components/performance/EmailReportDialog';
import { PerformanceFilters } from '@/components/performance/PerformanceFilters';
import { apiFetch } from '@/lib/api';
import { asEmailBody, asEmailSubject } from '@/lib/performance-email';
import { can, requireUser } from '@/lib/auth';
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
  href,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: 'warn';
  /** Where the number opens. Omitted for figures with nothing behind them. */
  href?: Route;
}) {
  const body = (
    <>
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
    </>
  );

  // A tile with nothing behind it stays a plain card rather than becoming a
  // link that goes nowhere — a dead control is worse than none.
  if (!href) return <div className="card p-4">{body}</div>;

  return (
    <Link
      href={href}
      className="card block p-4 transition-colors hover:bg-[var(--color-surface-muted)]"
    >
      {body}
    </Link>
  );
}

/**
 * A number in the table that opens the leads behind it.
 *
 * Zero is deliberately not a link: an empty list reached by clicking a zero
 * tells the reader nothing they did not already know, and makes every row
 * look clickable when most of it is not.
 */
function Drill({ value, href }: { value: number; href: Route }) {
  if (value === 0) return <span className="text-[var(--color-text-subtle)]">0</span>;
  return (
    <Link href={href} className="font-semibold hover:underline">
      {formatNumber(value)}
    </Link>
  );
}

/**
 * A link from a number to the leads behind it.
 *
 * Every figure on this page is a count of leads, and until now none could be
 * opened — a manager reading "7 never contacted" had to rebuild that filter
 * by hand in the leads list. The drill-down applies the same filter the
 * number was computed from, so the list cannot disagree with the figure that
 * led to it.
 *
 * `ownerId` is left out for the totals row, which spans everybody in scope.
 */
function drillHref(filters: Record<string, string | undefined>): Route {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.append(key, value);
  }
  const query = params.toString();
  return (query ? `/leads?${query}` : '/leads') as Route;
}

/** Open statuses, as repeated query parameters. */
const OPEN_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL'];

function openHref(ownerId?: string): Route {
  const params = new URLSearchParams();
  if (ownerId) params.set('ownerId', ownerId);
  for (const status of OPEN_STATUSES) params.append('status', status);
  return `/leads?${params.toString()}` as Route;
}

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  // This page checked that you were signed in and nothing more, so it opened
  // for every role that could reach the API behind it. The API refuses the
  // data now, which would leave a signed-in reader staring at an error; this
  // is the courtesy redirect in front of that refusal.
  if (!can(user, 'performance:read')) redirect('/dashboard');

  const params = await searchParams;

  const scope = (params.scope as PerformanceScope) ?? 'TEAM';
  const period = (params.period as PerformancePeriodKind) ?? 'AS_ON_DATE';
  const designationId = params.designationId ?? '';
  const userId = params.userId ?? '';
  const orgUnitId = params.orgUnitId ?? '';
  const verticalHeadId = params.verticalHeadId ?? '';

  const query = new URLSearchParams({ scope, period });
  if (designationId) query.set('designationId', designationId);
  if (userId) query.set('userId', userId);
  if (orgUnitId) query.set('orgUnitId', orgUnitId);
  if (verticalHeadId) query.set('verticalHeadId', verticalHeadId);

  const [report, designations, orgUnits, verticals] = await Promise.all([
    apiFetch<PerformanceReport>(`/performance/report?${query.toString()}`),
    // Empty lists narrow the filters rather than failing the page: a report
    // that will not load because a dropdown could not be filled is worse than
    // one with fewer ways to slice it.
    apiFetch<Array<{ id: string; name: string }>>('/admin/designations').catch(() => []),
    apiFetch<Array<{ id: string; name: string; type: string }>>('/org-units').catch(() => []),
    apiFetch<Array<{ id: string; fullName: string; email: string; people: number }>>(
      '/performance/verticals',
    ).catch(() => []),
  ]);

  const emailBody = asEmailBody(report);
  const subject = asEmailSubject(report);

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
        {/* The daily round, for whoever sends it. One email per vertical head,
            each previewed on its own rather than fired as a batch. */}
        <Link href="/performance/verticals" className="btn btn-outline">
          Vertical head reports
        </Link>
      </header>

      <PerformanceFilters
        scope={scope}
        period={period}
        designationId={designationId}
        userId={userId}
        orgUnitId={orgUnitId}
        verticalHeadId={verticalHeadId}
        designations={designations}
        orgUnits={orgUnits}
        verticals={verticals}
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
        <Stat
          label="Total leads"
          value={formatNumber(report.totals.totalLeads)}
          href={drillHref({})}
        />
        <Stat label="Open" value={formatNumber(report.totals.openLeads)} href={openHref()} />
        <Stat
          label="Conversion"
          value={`${report.totals.conversionRate ?? 0}%`}
          note={
            report.progress?.conversionRateDelta != null
              ? `${report.progress.conversionRateDelta >= 0 ? '+' : ''}${report.progress.conversionRateDelta} pts vs ${report.progress.previousLabel}`
              : undefined
          }
        />
        <Stat
          label="Converted"
          value={formatNumber(report.totals.converted)}
          href={drillHref({ status: 'CONVERTED' })}
        />
        <Stat
          label="Never contacted"
          value={formatNumber(report.totals.unattendedEver)}
          href={drillHref({ contact: 'never' })}
          note="No interaction since the lead was created"
          tone="warn"
        />
        <Stat
          label="No contact 2 days+"
          value={formatNumber(report.totals.unattendedTwoDays)}
          href={drillHref({ contact: 'stale' })}
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
                  '#',
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
              {report.rows.map((row, index) => (
                <tr
                  key={row.userId}
                  className="border-b border-[var(--color-border)] last:border-0"
                >
                  <td className="tnum px-3 py-2.5 align-top text-xs text-[var(--color-text-subtle)]">
                    {index + 1}
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <span className="font-semibold">{row.fullName}</span>
                    <span className="block text-xs text-[var(--color-text-subtle)]">
                      {[row.employeeCode, row.designation, row.branch].filter(Boolean).join(' · ')}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 align-top tnum">
                    <Drill value={row.totalLeads} href={drillHref({ ownerId: row.userId })} />
                  </td>
                  <td className="px-3 py-2.5 align-top tnum">
                    <Drill value={row.openLeads} href={openHref(row.userId)} />
                  </td>
                  <td className="px-3 py-2.5 align-top tnum">
                    <Drill
                      value={row.converted}
                      href={drillHref({ ownerId: row.userId, status: 'CONVERTED' })}
                    />
                  </td>
                  <td className="px-3 py-2.5 align-top tnum">
                    {row.conversionRate === null ? '—' : `${row.conversionRate}%`}
                  </td>
                  <td
                    className={`px-3 py-2.5 align-top tnum ${
                      row.unattendedEver > 0 ? 'font-semibold text-[var(--color-warn-strong)]' : ''
                    }`}
                  >
                    <Drill
                      value={row.unattendedEver}
                      href={drillHref({ ownerId: row.userId, contact: 'never' })}
                    />
                  </td>
                  <td className="px-3 py-2.5 align-top tnum">
                    <Drill
                      value={row.unattendedTwoDays}
                      href={drillHref({ ownerId: row.userId, contact: 'stale' })}
                    />
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
      {/* Gated on `report:send`, which the API now requires. Reading this page
          is `analytics:sales:read` and every sales role holds it, so without
          this the button was offered to people the endpoint would refuse. */}
      {can(user, 'report:send') &&
      report.suggestedRecipients.length > 0 &&
      report.rows.length > 0 ? (
        <div className="flex justify-end">
          <EmailReportDialog
            subject={subject}
            body={emailBody}
            recipients={report.suggestedRecipients}
          />
        </div>
      ) : null}
    </div>
  );
}
