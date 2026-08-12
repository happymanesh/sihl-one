import Link from 'next/link';
import { redirect } from 'next/navigation';

import { LeadTrendChart } from '@/components/dashboard/LeadTrendChart';
import { MyStanding } from '@/components/dashboard/MyStanding';
import { SourceBreakdown } from '@/components/dashboard/SourceBreakdown';
import { StatTile } from '@/components/ui/StatTile';
import { Icon } from '@/components/shell/Icon';
import { apiFetch } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';
import { formatCompactCurrency, formatNumber, humanise } from '@/lib/format';
import type { Scorecard } from '@sihl-one/contracts';

export const metadata = { title: 'Dashboard' };

interface Overview {
  leads: {
    total: number;
    newToday: number;
    open: number;
    hot: number;
    unassigned: number;
    overdueFollowUps: number;
    createdLast30: number;
    convertedLast30: number;
    pipelineValue: string;
    conversionRate: number;
    conversionRateDelta: number;
    createdDeltaPercent: number | null;
    byStatus: Array<{ status: string; count: number }>;
    bySource: Array<{ source: string; count: number }>;
  };
  customers: { total: number; onboarding: number; activatedLast30: number };
  tasks: { open: number; overdue: number };
}

type TrendPoint = { date: string; created: number; converted: number };
type Performer = { userId: string; fullName: string; conversions: number };

export default async function DashboardPage() {
  const user = await requireUser();
  // A partner reaching this URL directly — a bookmark, a shared link, the
  // post-login default — belongs on their own portal, not on an error card.
  if (!can(user, 'analytics:sales:read')) {
    redirect(can(user, 'analytics:partner:read') ? '/partner' : '/leads');
  }

  // Three independent reads in parallel. Sequential awaits here would make the
  // slowest screen in the app the first one anybody sees.
  const [overview, trend, performers, scorecard] = await Promise.all([
    apiFetch<Overview>('/dashboard/overview'),
    apiFetch<TrendPoint[]>('/dashboard/lead-trend?days=30'),
    apiFetch<Performer[]>('/dashboard/top-performers?limit=5').catch(() => [] as Performer[]),
    // Nobody should be locked out of their dashboard because a rating could not
    // be computed, so this degrades to nothing rather than throwing.
    user.permissions.includes('analytics:sales:read')
      ? apiFetch<Scorecard>('/performance/me?days=90').catch(() => null)
      : null,
  ]);

  const { leads, customers, tasks } = overview;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Good to see you, {user.firstName}</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {humanise(user.dataScope)} scope
            {user.orgUnitName ? ` · ${user.orgUnitName}` : ''} · figures cover the last 30 days
          </p>
        </div>
        {user.permissions.includes('lead:create') ? (
          <Link href="/leads/new" className="btn btn-primary">
            <Icon name="plus" size={16} />
            New lead
          </Link>
        ) : null}
      </header>

      {scorecard ? <MyStanding card={scorecard} /> : null}

      {/*
        Attention row first. These four are the things a user should act on
        today; the volume metrics below are context. Ordering it the other way
        buries the overdue count under a number nobody can do anything about.
      */}
      <section aria-label="Needs attention">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Overdue follow-ups"
            value={formatNumber(leads.overdueFollowUps)}
            hint={leads.overdueFollowUps > 0 ? 'Past their committed date' : 'Nothing overdue'}
            tone={leads.overdueFollowUps > 0 ? 'danger' : 'default'}
            href="/leads?overdueOnly=true"
          />
          <StatTile
            label="Unassigned leads"
            value={formatNumber(leads.unassigned)}
            hint={leads.unassigned > 0 ? 'Nobody is accountable yet' : 'All leads have an owner'}
            tone={leads.unassigned > 0 ? 'warning' : 'default'}
            href="/leads?status=NEW"
          />
          <StatTile
            label="Hot leads"
            value={formatNumber(leads.hot)}
            hint="Score 70 and above"
            href="/leads?minScore=70"
          />
          <StatTile
            label="Overdue tasks"
            value={formatNumber(tasks.overdue)}
            hint={`${formatNumber(tasks.open)} open in total`}
            tone={tasks.overdue > 0 ? 'warning' : 'default'}
            href="/tasks?overdueOnly=true"
          />
        </div>
      </section>

      <section aria-label="Pipeline">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Open pipeline"
            value={formatCompactCurrency(leads.pipelineValue)}
            hint={`${formatNumber(leads.open)} active leads`}
          />
          <StatTile
            label="New leads (30d)"
            value={formatNumber(leads.createdLast30)}
            delta={leads.createdDeltaPercent}
          />
          <StatTile
            label="Conversion rate"
            value={`${leads.conversionRate}%`}
            delta={leads.conversionRateDelta}
            deltaSuffix="pp"
          />
          <StatTile
            label="Customers onboarding"
            value={formatNumber(customers.onboarding)}
            hint={`${formatNumber(customers.activatedLast30)} activated in 30 days`}
            href="/customers?status=ONBOARDING"
          />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="card p-5 xl:col-span-2">
          <div className="flex items-baseline justify-between">
            <h2 className="font-bold">Leads created vs converted</h2>
            <span className="text-xs text-[var(--color-text-subtle)]">Last 30 days</span>
          </div>
          <LeadTrendChart data={trend} />
        </div>

        <div className="card p-5">
          <h2 className="font-bold">Where leads come from</h2>
          <SourceBreakdown data={leads.bySource} />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="card p-5 xl:col-span-2">
          <h2 className="font-bold">Pipeline by stage</h2>
          <ul className="mt-4 space-y-2.5">
            {leads.byStatus.map((row) => {
              const max = Math.max(...leads.byStatus.map((item) => item.count), 1);
              return (
                <li key={row.status} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 text-xs font-semibold text-[var(--color-text-muted)]">
                    {humanise(row.status)}
                  </span>
                  <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-inset)]">
                    <span
                      className="block h-full rounded-full bg-navy-500"
                      style={{ width: `${(row.count / max) * 100}%` }}
                    />
                  </span>
                  <span className="w-10 shrink-0 text-right text-sm font-bold tnum">
                    {row.count}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="card p-5">
          <h2 className="font-bold">Top performers</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
            Conversions in the last 30 days
          </p>
          {performers.length === 0 ? (
            <p className="mt-5 text-sm text-[var(--color-text-muted)]">
              No conversions recorded in this period.
            </p>
          ) : (
            <ol className="mt-4 space-y-3">
              {performers.map((performer, index) => (
                <li key={performer.userId} className="flex items-center gap-3">
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      index === 0
                        ? 'bg-brand-green-500 text-white'
                        : 'bg-[var(--color-surface-inset)] text-[var(--color-text-muted)]'
                    }`}
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {performer.fullName}
                  </span>
                  <span className="text-sm font-bold tnum">{performer.conversions}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
