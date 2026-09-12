import Link from 'next/link';
import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { ACTIVITY_METRICS, type ActivityDetail, type ActivityMetric } from '@sihl-one/contracts';

import { apiFetch } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { formatDateTime, formatNumber } from '@/lib/format';
import { LeadTable } from '@/components/leads/LeadTable';

export const metadata = { title: 'Activity detail' };

interface ProductItem {
  code: string;
  name: string;
}

/**
 * The records behind one number on the daily report.
 *
 * A count on its own invites a conversation nobody can settle — "you logged
 * three updates yesterday" against "I worked all day". This is the list that
 * settles it.
 *
 * Leads render through the Leads screen's own table, not a second rendering of
 * the same record: a manager who drills into a figure should land somewhere
 * they already know how to read.
 */
export default async function ActivityDetailPage({
  searchParams,
}: {
  searchParams: Promise<{ userId?: string; date?: string; metric?: string }>;
}) {
  await requireUser();
  const { userId, date, metric } = await searchParams;

  if (
    !userId ||
    !date ||
    !metric ||
    !(ACTIVITY_METRICS as readonly string[]).includes(metric)
  ) {
    notFound();
  }

  const query = new URLSearchParams({ userId, date, metric: metric as ActivityMetric });
  const [detail, products] = await Promise.all([
    apiFetch<ActivityDetail>(`/reports/daily/detail?${query.toString()}`),
    apiFetch<ProductItem[]>('/masters/products').catch(() => [] as ProductItem[]),
  ]);
  const productLabels = Object.fromEntries(products.map((item) => [item.code, item.name]));

  const listed = detail.leads.length + detail.visits.length;
  // "Ten updates across four leads" — the report counts edits, this lists the
  // leads they landed on, and saying so is better than two numbers that look
  // like one of them is wrong.
  const countsDiffer = detail.leads.length > 0 && detail.count !== detail.leads.length;

  return (
    <div className="space-y-4">
      <div>
        {/*
          Back to the day that was being read, not to today's report — landing
          on a different date than the one you left is disorienting, and it is
          the commonest way a drill-down loses somebody.
        */}
        <Link
          href={`/reports/daily?date=${detail.date}` as Route}
          className="text-sm font-semibold text-[var(--color-text-muted)] underline underline-offset-2 hover:text-[var(--color-text)]"
        >
          ← Back to {detail.date}
        </Link>

        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">{detail.label}</h1>
            <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
              {detail.person.fullName}
              {detail.person.employeeCode ? ` · ${detail.person.employeeCode}` : ''} ·{' '}
              {detail.date}
              {detail.metric === 'openLeads' ? ' · open at the end of that day' : ''}
              {countsDiffer
                ? ` · ${formatNumber(detail.count)} ${
                    detail.metric === 'leadsUpdated' ? 'updates' : 'changes'
                  } across ${formatNumber(detail.leads.length)} leads`
                : ''}
            </p>
          </div>

          {/*
            The live screen, for acting on the list rather than reading it —
            filters, search, export. Deliberately a separate link instead of
            making the figures link straight there: this page is the day as it
            stood, and the Leads screen is the present, so the two will differ
            the moment anything closes.
          */}
          {detail.leads.length > 0 ? (
            <Link
              href={`/leads?ownerId=${detail.person.userId}` as Route}
              className="text-sm font-semibold underline underline-offset-2"
            >
              Open in Leads →
            </Link>
          ) : null}
        </div>
      </div>

      {detail.truncated ? (
        <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-sm text-[var(--color-text-muted)]">
          Showing the first 200. A list this long is a backlog to work through on the Leads
          screen rather than something to read here.
        </p>
      ) : null}

      {listed === 0 ? (
        <p className="card p-6 text-sm text-[var(--color-text-muted)]">
          Nothing recorded. The count on the report was zero.
        </p>
      ) : null}

      {detail.leads.length > 0 ? (
        <LeadTable leads={detail.leads} productLabels={productLabels} />
      ) : null}

      {detail.visits.length > 0 ? (
        <ul className="card divide-y divide-[var(--color-border)]">
          {detail.visits.map((row) => (
            <li key={row.id}>
              <Link
                href={row.href as Route}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 hover:bg-[var(--color-surface-inset)]"
              >
                <span className="font-medium">{row.title}</span>
                <span className="font-mono text-xs text-[var(--color-text-subtle)]">
                  {row.reference}
                </span>
                {row.subtitle ? (
                  <span className="text-xs text-[var(--color-text-muted)]">{row.subtitle}</span>
                ) : null}
                {row.at ? (
                  <span className="ml-auto text-xs text-[var(--color-text-subtle)]">
                    {formatDateTime(row.at)}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
