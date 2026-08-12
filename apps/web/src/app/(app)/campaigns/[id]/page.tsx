import Link from 'next/link';
import type { CampaignDetail } from '@sihl-one/contracts';

import { Badge } from '@/components/ui/Badge';
import { CampaignActions } from '@/components/campaigns/CampaignActions';
import { CopyField } from '@/components/ui/CopyField';
import { StatTile } from '@/components/ui/StatTile';
import { apiFetch } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';
import { formatCompactCurrency, formatDate, formatNumber, humanise } from '@/lib/format';

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const campaign = await apiFetch<CampaignDetail>(`/campaigns/${id}`).catch(() => null);
  return { title: campaign ? campaign.name : 'Campaign' };
}

const STATUS_TONES: Record<string, 'green' | 'teal' | 'amber' | 'navy' | 'neutral'> = {
  DRAFT: 'neutral',
  SCHEDULED: 'navy',
  RUNNING: 'green',
  PAUSED: 'amber',
  COMPLETED: 'teal',
  ARCHIVED: 'neutral',
};

export default async function CampaignDetailPage({ params }: Props) {
  const user = await requireUser();
  const { id } = await params;

  const campaign = await apiFetch<CampaignDetail>(`/campaigns/${id}`);
  const { performance } = campaign;

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/campaigns"
          className="text-xs font-semibold text-[var(--color-text-muted)] hover:underline"
        >
          ← All campaigns
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold">{campaign.name}</h1>
            <Badge tone={STATUS_TONES[campaign.status] ?? 'neutral'}>
              {humanise(campaign.status)}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            <span className="font-mono">{campaign.code}</span> ·{' '}
            {campaign.channels.map((channel) => humanise(channel)).join(', ')}
            {campaign.owner ? ` · ${campaign.owner.fullName}` : ''}
          </p>
          {campaign.objective ? (
            <p className="mt-1.5 max-w-2xl text-sm">{campaign.objective}</p>
          ) : null}
        </div>

        {can(user, 'campaign:update') ? (
          <CampaignActions
            campaignId={campaign.id}
            status={campaign.status}
            allowedTransitions={campaign.allowedTransitions}
            budget={campaign.budget}
            actualSpend={campaign.actualSpend}
          />
        ) : null}
      </header>

      <section aria-label="Attribution">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Leads attributed"
            value={formatNumber(performance.leads)}
            hint={`${performance.qualified} reached qualified`}
          />
          <StatTile
            label="Converted"
            value={formatNumber(performance.converted)}
            hint={`${performance.conversionRate}% of attributed leads`}
          />
          <StatTile
            label="Cost per lead"
            value={
              performance.costPerLead === null
                ? '—'
                : formatCompactCurrency(performance.costPerLead)
            }
            // Null, never zero. "Free" is a claim that gets campaigns renewed.
            hint={performance.costPerLead === null ? 'Record the spend to see this' : undefined}
          />
          <StatTile
            label="Cost per acquisition"
            value={
              performance.costPerAcquisition === null
                ? '—'
                : formatCompactCurrency(performance.costPerAcquisition)
            }
            hint={
              performance.costPerAcquisition === null
                ? performance.converted === 0
                  ? 'Nothing converted yet'
                  : 'Record the spend to see this'
                : undefined
            }
          />
        </div>
      </section>

      <section className="card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-bold">Spend</h2>
          {performance.budgetUsedPercent !== null ? (
            <Badge tone={performance.budgetUsedPercent > 100 ? 'red' : 'neutral'}>
              {performance.budgetUsedPercent}% of budget
            </Badge>
          ) : (
            <Badge tone="neutral">Spend not recorded</Badge>
          )}
        </div>

        <p className="mt-3 text-sm">{performance.verdict}</p>

        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-[var(--color-text-muted)]">Budget</p>
            <p className="mt-0.5 text-xl font-bold tnum">
              {campaign.budget ? formatCompactCurrency(campaign.budget) : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--color-text-muted)]">Spent</p>
            <p className="mt-0.5 text-xl font-bold tnum">
              {campaign.actualSpend ? formatCompactCurrency(campaign.actualSpend) : '—'}
            </p>
          </div>
          <div>
            {/*
              Labelled "business won", never "return". A lead's estimated value
              is the size of the client, not brokerage earned on them — calling
              the ratio a return produces a 75x figure that would get a budget
              renewed on a number nobody checked.
            */}
            <p className="text-xs text-[var(--color-text-muted)]">Business won</p>
            <p className="mt-0.5 text-xl font-bold tnum">
              {formatCompactCurrency(performance.attributedValue)}
            </p>
            {performance.attributedValuePerRupee !== null ? (
              <p className="text-xs text-[var(--color-text-subtle)]">
                ₹{performance.attributedValuePerRupee} per ₹1 spent
              </p>
            ) : null}
          </div>
          <div>
            <p className="text-xs text-[var(--color-text-muted)]">Runs</p>
            <p className="mt-0.5 text-sm font-semibold">
              {campaign.startsAt ? formatDate(campaign.startsAt) : 'Not started'}
              {campaign.endsAt ? ` → ${formatDate(campaign.endsAt)}` : ''}
            </p>
          </div>
        </div>

        {performance.caveat ? (
          <p className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
            {performance.caveat}
          </p>
        ) : null}
      </section>

      <section className="card p-5">
        <h2 className="font-bold">Tracking link</h2>
        <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
          Publish this, not a hand-typed one. A mistyped code produces leads that arrive
          unattributed, and nobody notices until this page reads zero.
        </p>
        <div className="mt-3">
          <CopyField value={campaign.trackingUrl} label="Campaign tracking URL" />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="card p-5">
          <h2 className="font-bold">Where the leads came from</h2>
          {campaign.sources.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--color-text-muted)]">
              No attributed leads yet.
            </p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {campaign.sources.map((source) => (
                <li key={source.source}>
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-semibold">{humanise(source.source)}</span>
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {formatNumber(source.leads)} {source.leads === 1 ? 'lead' : 'leads'} ·{' '}
                      {formatNumber(source.converted)} converted
                    </span>
                  </div>
                  <span className="mt-1 block h-2 overflow-hidden rounded-full bg-[var(--color-surface-inset)]">
                    <span
                      className="block h-full rounded-full bg-navy-500"
                      style={{
                        width: `${Math.max(2, (source.leads / campaign.sources[0]!.leads) * 100)}%`,
                      }}
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="font-bold">Pipeline</h2>
            {performance.leads > 0 ? (
              <Link
                href={`/leads?campaignId=${campaign.id}`}
                className="text-xs font-semibold text-teal-600 hover:underline dark:text-teal-300"
              >
                View the leads
              </Link>
            ) : null}
          </div>

          {campaign.pipeline.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--color-text-muted)]">Nothing in flight.</p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--color-border)]">
              {campaign.pipeline.map((stage) => (
                <li key={stage.status} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm">{humanise(stage.status)}</span>
                  <span className="text-sm tnum">
                    {formatNumber(stage.count)}
                    <span className="ml-2 text-xs text-[var(--color-text-subtle)]">
                      {formatCompactCurrency(stage.value)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
