import Link from 'next/link';
import type { Route } from 'next';
import type { Customer360 } from '@sihl-one/contracts';

import { Badge, KycBadge } from '@/components/ui/Badge';
import { DocumentPanel } from '@/components/documents/DocumentPanel';
import { Icon } from '@/components/shell/Icon';
import { apiFetch } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';
import { formatCompactCurrency, formatDate, formatRelative, humanise } from '@/lib/format';

const STAGES = [
  'LEAD',
  'KYC_STARTED',
  'PAN_VERIFIED',
  'BANK_VERIFIED',
  'ESIGN_PENDING',
  'ESIGN_DONE',
  'UNDER_REVIEW',
  'ACCOUNT_OPENED',
  'ACTIVATED',
] as const;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const customer = await apiFetch<Customer360>(`/customers/${id}`);
    return { title: customer.profile.fullName };
  } catch {
    return { title: 'Customer' };
  }
}

/** Customer 360 — one screen, one API call. */
export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const view = await apiFetch<Customer360>(`/customers/${id}`);
  const { profile, onboarding, relationship, acquisition, holdings, engagement, insights } = view;
  const currentStageIndex = STAGES.indexOf(onboarding.onboardingStage as (typeof STAGES)[number]);

  return (
    <div className="space-y-5">
      <nav className="text-xs text-[var(--color-text-muted)]">
        <Link href="/customers" className="hover:underline">
          Customers
        </Link>
        <span className="mx-1.5" aria-hidden>/</span>
        <span className="font-mono">{profile.reference}</span>
      </nav>

      <header className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-bold">{profile.fullName}</h1>
              <Badge tone={profile.status === 'ACTIVE' ? 'green' : 'blue'}>
                {humanise(profile.status)}
              </Badge>
              <KycBadge status={onboarding.kycStatus} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--color-text-muted)]">
              <span className="tnum">{profile.mobileMasked}</span>
              <span>{profile.email}</span>
              <span className="font-mono">{profile.panMasked}</span>
              {profile.city ? <span>{profile.city}</span> : null}
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-[var(--color-text-subtle)]">Onboarding progress</p>
            <p className="text-2xl font-bold tnum">{onboarding.progressPercent}%</p>
          </div>
        </div>
      </header>

      {insights.length > 0 ? (
        <section aria-label="Insights" className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {insights.map((insight) => (
            <div
              key={insight.code}
              className={`card border-l-[3px] p-3.5 ${
                insight.severity === 'RISK'
                  ? 'border-l-danger-500'
                  : insight.severity === 'WARN'
                    ? 'border-l-warn-500'
                    : 'border-l-navy-300'
              }`}
            >
              <p className="text-sm font-bold">{insight.title}</p>
              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{insight.detail}</p>
            </div>
          ))}
        </section>
      ) : null}

      <section className="card p-5">
        <h2 className="font-bold">Onboarding journey</h2>
        {/* A horizontal stepper rather than a percentage alone: an ops user needs
            to know *which* step is blocking, not how far along it is. */}
        <ol className="mt-4 flex gap-1 overflow-x-auto pb-2">
          {STAGES.map((stage, index) => {
            const done = index < currentStageIndex;
            const current = index === currentStageIndex;
            return (
              <li key={stage} className="min-w-[104px] flex-1">
                <span
                  className={`block h-1.5 rounded-full ${
                    done ? 'bg-teal-500' : current ? 'bg-navy-500' : 'bg-[var(--color-surface-inset)]'
                  }`}
                />
                <p
                  className={`mt-1.5 text-[0.6875rem] leading-tight ${
                    current
                      ? 'font-bold text-[var(--color-text)]'
                      : 'text-[var(--color-text-subtle)]'
                  }`}
                >
                  {humanise(stage)}
                </p>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="font-bold">Product holdings</h2>
            {holdings.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--color-text-muted)]">
                No holdings mirrored from the back office yet. Holdings appear once the account is
                open and the nightly sync has run.
              </p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-xs uppercase text-[var(--color-text-muted)]">
                  <tr>
                    <th scope="col" className="pb-2">Product</th>
                    <th scope="col" className="pb-2">Status</th>
                    <th scope="col" className="pb-2">Opened</th>
                    <th scope="col" className="pb-2 text-right">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {holdings.map((holding) => (
                    <tr key={holding.product}>
                      <td className="py-2 font-semibold">{humanise(holding.product)}</td>
                      <td className="py-2">
                        <Badge tone={holding.status === 'ACTIVE' ? 'green' : 'neutral'}>
                          {humanise(holding.status)}
                        </Badge>
                      </td>
                      <td className="py-2 text-xs text-[var(--color-text-muted)]">
                        {formatDate(holding.openedAt)}
                      </td>
                      <td className="py-2 text-right font-semibold tnum">
                        {formatCompactCurrency(holding.value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-3 text-xs text-[var(--color-text-subtle)]">
              Holdings are mirrored read-only from the back office. SIHL ONE is not the book of
              record for positions or balances.
            </p>
          </section>

          <DocumentPanel
            entityType="CUSTOMER"
            entityId={id}
            canUpload={can(user, 'customer:update')}
          />

          <section className="card p-5">
            <h2 className="font-bold">Engagement</h2>
            <dl className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Metric label="Interactions" value={String(engagement.totalActivities)} />
              <Metric label="Open tasks" value={String(engagement.openTasks)} />
              <Metric
                label="Last contact"
                value={engagement.lastActivityAt ? formatRelative(engagement.lastActivityAt) : 'Never'}
              />
              <Metric
                label="Last visit"
                value={engagement.lastVisitAt ? formatRelative(engagement.lastVisitAt) : 'None'}
              />
            </dl>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="card p-5">
            <h2 className="font-bold">Relationship</h2>
            <dl className="mt-3 space-y-2.5 text-sm">
              <Row label="Manager" value={relationship.relationshipManager?.fullName ?? 'Unassigned'} />
              <Row label="Branch" value={relationship.orgUnit?.name ?? '—'} />
              <Row label="Partner" value={relationship.partner?.name ?? 'Direct'} />
            </dl>
          </section>

          <section className="card p-5">
            <h2 className="font-bold">How we acquired them</h2>
            <dl className="mt-3 space-y-2.5 text-sm">
              <Row label="Source" value={acquisition.source ? humanise(acquisition.source) : '—'} />
              <Row label="Campaign" value={acquisition.campaign?.name ?? '—'} />
              <Row label="Converted" value={formatDate(acquisition.convertedAt)} />
            </dl>
            {acquisition.leadId ? (
              <Link
                href={`/leads/${acquisition.leadId}`}
                className="btn btn-outline mt-4 w-full text-xs"
              >
                View originating lead {acquisition.leadReference}
              </Link>
            ) : null}
            {can(user, 'visit:create') ? (
              <Link
                href={`/visits/new?entityType=CUSTOMER&entityId=${id}` as Route}
                className="btn btn-outline mt-2 w-full text-xs"
              >
                <Icon name="pin" size={14} />
                Plan a field visit
              </Link>
            ) : null}
          </section>

          <section className="card p-5">
            <h2 className="font-bold">Key dates</h2>
            <dl className="mt-3 space-y-2.5 text-sm">
              <Row label="Customer since" value={formatDate(profile.createdAt)} />
              <Row label="Account opened" value={formatDate(onboarding.accountOpenedAt)} />
              <Row label="Activated" value={formatDate(onboarding.activatedAt)} />
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[var(--color-text-muted)]">{label}</dt>
      <dd className="truncate text-right font-medium">{value}</dd>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-0.5 text-lg font-bold">{value}</dd>
    </div>
  );
}
