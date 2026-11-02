import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { PerformanceReport } from '@sihl-one/contracts';

import { EmailReportDialog } from '@/components/performance/EmailReportDialog';
import { apiFetch, toQuery } from '@/lib/api';
import { asEmailBody, asEmailSubject } from '@/lib/performance-email';
import { can, requireUser } from '@/lib/auth';
import { formatNumber } from '@/lib/format';

export const metadata = { title: 'Vertical head reports' };

interface VerticalReport {
  head: { id: string; fullName: string; email: string };
  report: PerformanceReport;
}

/**
 * The daily round of vertical-head emails, all in one place.
 *
 * One email per head, each previewed and sent on its own. Nothing goes
 * automatically: this mails a judgement of people's work to the person
 * accountable for them, and a batch that sent itself would be a batch nobody
 * read before it landed.
 *
 * Deliberately not a single "send all" that fires without review. Each head's
 * report is a different set of numbers about different people, and the whole
 * value of the preview is noticing the one that is wrong.
 */
export default async function VerticalReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user, 'analytics:sales:read')) redirect('/dashboard');

  const params = await searchParams;

  const batch = await apiFetch<VerticalReport[]>(
    `/performance/report/verticals${toQuery({
      period: params.period ?? 'AS_ON_DATE',
      date: params.date,
    })}`,
  ).catch(() => [] as VerticalReport[]);

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/performance"
          className="text-xs font-semibold text-[var(--color-text-muted)] hover:underline"
        >
          ← Performance
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-bold">Vertical head reports</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {formatNumber(batch.length)} {batch.length === 1 ? 'vertical' : 'verticals'}
          {batch.length > 0 ? ` · ${batch[0].report.period.label}` : ''} · every report below
          covers the same day
        </p>
      </header>

      {batch.length === 0 ? (
        <div className="card p-6">
          <h2 className="text-lg font-bold">No verticals to report on</h2>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            A vertical is a National Head with people reporting into them. If this is empty, either
            nobody has a reporting line that reaches a National Head, or the only one who does is
            excluded as the non-vertical head.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {batch.map(({ head, report }) => {
            const body = asEmailBody(report);
            return (
              <section key={head.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold">{head.fullName}</h2>
                    <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                      {head.email || 'No email on file'} ·{' '}
                      {formatNumber(report.totals.resourceCount)}{' '}
                      {report.totals.resourceCount === 1 ? 'person' : 'people'} ·{' '}
                      {formatNumber(report.totals.totalLeads)} leads ·{' '}
                      {formatNumber(report.totals.converted)} converted
                    </p>
                  </div>

                  {/*
                    Sending is refused rather than silently skipped when there
                    is no address: a head who never receives their report and
                    is never told is worse off than one who sees an error.
                  */}
                  {!can(user, 'report:send') ? null : head.email ? (
                    <EmailReportDialog
                      subject={asEmailSubject(report)}
                      body={body}
                      recipients={[{ fullName: head.fullName, email: head.email }]}
                    />
                  ) : (
                    <p className="text-xs font-semibold text-danger-500">
                      No email address — cannot send
                    </p>
                  )}
                </div>

                {/* The body as it will arrive, not a summary of it. */}
                <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 text-xs">
                  {body}
                </pre>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
