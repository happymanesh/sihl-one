import { redirect } from 'next/navigation';
import type { Route } from 'next';
import type { MisTeamReport } from '@sihl-one/contracts';

import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/shell/Icon';
import { StatTile } from '@/components/ui/StatTile';
import { TeamTree } from '@/components/mis/TeamTree';
import { apiFetch } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';
import { formatDateCompact } from '@/lib/format';

export const metadata = { title: 'Team performance' };

/**
 * The firm down the reporting line.
 *
 * Unscoped, and the permission is the whole of the control — the API refuses
 * anybody without `mis:read`, and this redirect is the courtesy in front of
 * that refusal rather than the control itself.
 */
export default async function MisTeamPage() {
  const user = await requireUser();
  if (!can(user, 'mis:read')) redirect('/dashboard');

  const report = await apiFetch<MisTeamReport>('/mis/team');

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Team performance</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Every vertical down the reporting line, as on {formatDateCompact(report.asOn)}
            {report.chief ? ` · ${report.chief.name}` : ''}
          </p>
        </div>

        <a href="/api/mis/team/export" className="btn btn-outline" download>
          <Icon name="file" size={16} />
          Download CSV
        </a>
      </header>

      {report.chief === null ? (
        /*
          Without the chief executive there is no tree to build, and a blank
          table would read as "no business" rather than "the hierarchy is not
          set up". The code is named so somebody can go and fix it.
        */
        <div className="card">
          <EmptyState
            icon={<Icon name="users" size={40} />}
            title="No chief executive on record"
            description="This report is built from the reporting line above SIHL-0044. Nobody carries that employee code, so there is no structure to roll up. Set it on the right person in Administration → Users."
          />
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="People" value={report.totalPeople} />
            <StatTile
              label={`Idle ${report.idleAfterDays}+ days`}
              value={report.totalIdle}
              tone={report.totalIdle > 0 ? 'warning' : 'default'}
            />
            <StatTile
              label="Leads in the book"
              value={report.uniqueLeads.toLocaleString('en-IN')}
            />
            <StatTile
              label="Unassigned"
              value={report.exceptions.unassigned.total}
              tone={report.exceptions.unassigned.total > 0 ? 'danger' : 'default'}
              href={'/leads?owner=unassigned' as Route}
            />
          </div>

          {report.rows.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={<Icon name="users" size={40} />}
                title="Nobody reports to the chief executive"
                description="Verticals are the chief executive's direct reports. Until somebody reports to them there is nothing to group by — check the reporting lines in Administration → Users."
              />
            </div>
          ) : (
            <TeamTree report={report} />
          )}
        </>
      )}
    </div>
  );
}
