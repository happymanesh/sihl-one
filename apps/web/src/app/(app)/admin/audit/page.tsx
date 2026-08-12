import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { AuditEntryView } from '@sihl-one/contracts';

import { AuditFilters } from '@/components/admin/AuditFilters';
import { AuditRow } from '@/components/admin/AuditRow';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/shell/Icon';
import { Pagination } from '@/components/ui/Pagination';
import { StatTile } from '@/components/ui/StatTile';
import { apiFetch, toQuery } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';
import { formatNumber } from '@/lib/format';

export const metadata = { title: 'Audit trail' };

interface Summary {
  days: number;
  total: number;
  security: number;
  failedLogins: number;
  exports: number;
  permissionDenials: number;
  distinctActors: number;
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  // Guarded here as well as in the nav: a permission check that only exists
  // in the menu is one somebody can navigate around, and a raw 403 renders as
  // the generic error card rather than as "you do not have access".
  if (!can(user, 'audit:read')) redirect('/dashboard');

  const params = await searchParams;

  const [data, summary] = await Promise.all([
    apiFetch<{
      items: AuditEntryView[];
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    }>(
      `/audit${toQuery({
        q: params.q,
        action: params.action,
        resource: params.resource,
        securityOnly: params.securityOnly,
        from: params.from,
        to: params.to,
        page: params.page ?? '1',
        pageSize: '25',
      })}`,
    ),
    apiFetch<Summary>('/audit/summary?days=7'),
  ]);

  const isFiltered = Boolean(
    params.q || params.action || params.resource || params.securityOnly || params.from || params.to,
  );

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Audit trail</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Append-only. Entries cannot be edited or removed — including by an administrator.
        </p>
      </header>

      <section aria-label="Last 7 days">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Events (7 days)"
            value={formatNumber(summary.total)}
            hint={`${summary.distinctActors} people active`}
          />
          <StatTile
            label="Failed sign-ins"
            value={formatNumber(summary.failedLogins)}
            hint={summary.failedLogins > 0 ? 'Check for a pattern by account' : 'None'}
            tone={summary.failedLogins > 10 ? 'danger' : 'default'}
            href="/admin/audit?action=LOGIN_FAILED"
          />
          <StatTile
            label="Permission denials"
            value={formatNumber(summary.permissionDenials)}
            hint={
              summary.permissionDenials > 0
                ? 'Someone reached for something they lack'
                : 'None'
            }
            tone={summary.permissionDenials > 0 ? 'warning' : 'default'}
            href="/admin/audit?action=PERMISSION_DENIED"
          />
          <StatTile
            label="Exports"
            value={formatNumber(summary.exports)}
            hint="Exports by anyone serving notice are flagged"
            tone={summary.exports > 0 ? 'warning' : 'default'}
            href="/admin/audit?action=EXPORT"
          />
        </div>
      </section>

      <AuditFilters />

      {data.items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Icon name="file" size={40} />}
            title={isFiltered ? 'Nothing matches those filters' : 'No audit entries yet'}
            description={
              isFiltered
                ? 'Try a wider date range, or clear the filters.'
                : 'Every create, update, sign-in and export is recorded here as it happens.'
            }
            action={
              isFiltered ? (
                <Link href="/admin/audit" className="btn btn-outline">
                  Clear filters
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <div className="card p-0">
            <ul className="divide-y divide-[var(--color-border)]">
              {data.items.map((entry) => (
                <AuditRow key={entry.id} entry={entry} />
              ))}
            </ul>
          </div>

          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            pageSize={data.pageSize}
          />
        </>
      )}
    </div>
  );
}
