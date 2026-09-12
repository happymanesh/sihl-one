import type { SalesReport } from '@sihl-one/contracts';

import { apiFetch } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { formatCompactCurrency, formatDate, formatNumber, humanise } from '@/lib/format';
import { RangePicker } from '@/components/reports/RangePicker';

export const metadata = { title: 'Reports' };

/**
 * The sales report.
 *
 * One page for the whole hierarchy. A sales executive opens it and sees a
 * single row in "By person" — their own; a branch manager sees their branch;
 * the national head sees everyone. Nothing on this page decides that: the API
 * applies the caller's data scope before counting, so the page only has to
 * render whatever came back.
 */

function Rate({ value }: { value: number | null }) {
  if (value === null) {
    // No leads assigned means no rate. Showing 0% would rank somebody bottom of
    // a table they were never in — and this table gets read in appraisals.
    return <span className="text-[var(--color-text-subtle)]">—</span>;
  }
  return (
    <span className={value >= 40 ? 'font-semibold text-teal-600 dark:text-teal-400' : undefined}>
      {value}%
    </span>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 text-2xl font-bold tnum">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">{hint}</p> : null}
    </div>
  );
}

function Table({
  title,
  note,
  headers,
  rows,
}: {
  title: string;
  note?: string;
  headers: string[];
  rows: Array<Array<React.ReactNode>>;
}) {
  return (
    <section className="card overflow-hidden">
      <div className="border-b border-[var(--color-border)] px-5 py-3">
        <h2 className="font-semibold">{title}</h2>
        {note ? <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">{note}</p> : null}
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-[var(--color-text-muted)]">
          Nothing in this period.
        </p>
      ) : (
        // Wide tables scroll inside their own box; the page itself never
        // scrolls sideways, which matters because this is read on phones.
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left">
                {headers.map((header, i) => (
                  <th
                    key={header}
                    className={`px-4 py-2 text-xs font-medium text-[var(--color-text-muted)] ${
                      i === 0 ? '' : 'text-right'
                    }`}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr
                  key={r}
                  className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-inset)]"
                >
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      className={`px-4 py-2 ${c === 0 ? 'font-medium' : 'text-right tnum'}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requireUser();
  const { from, to } = await searchParams;

  const query = new URLSearchParams();
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  const suffix = query.toString() ? `?${query.toString()}` : '';

  const report = await apiFetch<SalesReport>(`/reports${suffix}`);
  const { summary } = report;
  const canExportLeads = user.permissions.includes('lead:export');

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {formatDate(summary.period.from)} to {formatDate(summary.period.to)} ·{' '}
            {summary.period.days} days · {formatNumber(summary.peopleInScope)}{' '}
            {summary.peopleInScope === 1 ? 'person' : 'people'} in your view ·{' '}
            {formatNumber(summary.activities)} activities · {formatNumber(summary.visits)} visits
          </p>
        </div>
        <RangePicker from={from} to={to} exportHref={`/api/reports/export${suffix}`} />
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Leads created"
          value={formatNumber(summary.leadsCreated)}
          hint={`${formatNumber(summary.unassigned)} open and unassigned`}
        />
        <Stat
          label="Converted"
          value={formatNumber(summary.leadsConverted)}
          hint={summary.conversionRate === null ? undefined : `${summary.conversionRate}% of created`}
        />
        {/*
          These last two are point-in-time, not period figures: the open book as
          it stands right now. Said plainly on the card, because a three-day
          report showing 34 overdue follow-ups otherwise reads as a contradiction
          and the reader stops trusting the rest of the page.
        */}
        <Stat
          label="Open pipeline"
          value={formatCompactCurrency(summary.pipelineValue)}
          hint="Open now · team estimate, not booked"
        />
        <Stat
          label="Overdue follow-ups"
          value={formatNumber(summary.overdueFollowUps)}
          hint="Open now, whatever the period"
        />
      </div>

      <Table
        title="By person"
        note="Converted counts conversions that happened in this window, whoever created the lead."
        headers={[
          'Name',
          'Assigned',
          'Open',
          'Converted',
          'Lost',
          'Conversion',
          'Activities',
          'Visits',
          'Joined',
          'Overdue',
          'Pipeline',
        ]}
        rows={report.byOwner.map((row) => [
          <span key="n">
            {row.ownerName}
            {row.branch ? (
              <span className="block text-xs font-normal text-[var(--color-text-subtle)]">
                {row.employeeCode ? `${row.employeeCode} · ` : ''}
                {row.branch}
              </span>
            ) : null}
          </span>,
          formatNumber(row.assigned),
          formatNumber(row.open),
          formatNumber(row.converted),
          formatNumber(row.lost),
          <Rate key="r" value={row.conversionRate} />,
          formatNumber(row.activities),
          formatNumber(row.visits),
          // Support on somebody else's visit, never added to their own count —
          // credit for a visit stays with its owner.
          formatNumber(row.joinedOthers),
          row.overdueFollowUps > 0 ? (
            <span key="o" className="font-semibold text-[var(--color-warn-strong)]">
              {formatNumber(row.overdueFollowUps)}
            </span>
          ) : (
            '0'
          ),
          formatCompactCurrency(row.pipelineValue),
        ])}
      />

      <div className="grid gap-5 lg:grid-cols-2">
        <Table
          title="By product"
          note="From per-product outcomes, so one lead can win equities and lose derivatives."
          headers={['Product', 'Interested', 'Open', 'Won', 'Lost', 'Conversion']}
          rows={report.byProduct.map((row) => [
            row.productName,
            formatNumber(row.interested),
            formatNumber(row.open),
            formatNumber(row.won),
            formatNumber(row.lost),
            <Rate key="r" value={row.conversionRate} />,
          ])}
        />

        <Table
          title="By source"
          headers={['Source', 'Leads', 'Converted', 'Lost', 'Conversion', 'Value']}
          rows={report.bySource.map((row) => [
            humanise(row.source),
            formatNumber(row.leads),
            formatNumber(row.converted),
            formatNumber(row.lost),
            <Rate key="r" value={row.conversionRate} />,
            formatCompactCurrency(row.pipelineValue),
          ])}
        />

        <Table
          title="By stage"
          headers={['Stage', 'Leads', 'Share']}
          rows={report.byStatus.map((row) => [
            humanise(row.status),
            formatNumber(row.leads),
            `${row.share}%`,
          ])}
        />

        <Table
          title="By branch"
          headers={['Branch', 'People', 'Leads', 'Converted', 'Conversion', 'Pipeline']}
          rows={report.byBranch.map((row) => [
            row.branch,
            formatNumber(row.people),
            formatNumber(row.leads),
            formatNumber(row.converted),
            <Rate key="r" value={row.conversionRate} />,
            formatCompactCurrency(row.pipelineValue),
          ])}
        />
      </div>

      <p className="text-xs text-[var(--color-text-subtle)]">
        Value figures are estimates entered by the team, not booked brokerage — this system
        records engagement, and the back office remains the record of account.
        {canExportLeads
          ? ' Your export includes a sheet of individual leads.'
          : ' Your export covers these totals; individual client rows need the lead export permission.'}
      </p>
    </div>
  );
}
