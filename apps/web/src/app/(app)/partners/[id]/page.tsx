import Link from 'next/link';
import type { LeadListItem, Partner360 } from '@sihl-one/contracts';

import { Badge, LeadStatusBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatTile } from '@/components/ui/StatTile';
import { apiFetch } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { formatCompactCurrency, formatDate, formatNumber, humanise } from '@/lib/format';

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const partner = await apiFetch<Partner360>(`/partners/${id}`).catch(() => null);
  return { title: partner ? partner.profile.name : 'Partner' };
}

const STATUS_TONES: Record<string, 'green' | 'amber' | 'red' | 'neutral'> = {
  ACTIVE: 'green',
  PENDING: 'amber',
  SUSPENDED: 'red',
  TERMINATED: 'neutral',
};

/**
 * Partner 360, staff view.
 *
 * The same endpoint the partner's own portal calls, with the same estimate
 * labelling. Staff seeing a confident-looking "commission due" that the partner
 * has never been shown is how the two sides end up quoting different numbers at
 * each other.
 */
export default async function PartnerDetailPage({ params }: Props) {
  await requireUser();
  const { id } = await params;

  const [partner, leads] = await Promise.all([
    apiFetch<Partner360>(`/partners/${id}`),
    apiFetch<{ items: LeadListItem[]; total: number }>(`/leads?partnerId=${id}&pageSize=8`).catch(
      () => ({ items: [] as LeadListItem[], total: 0 }),
    ),
  ]);

  const { profile, business, estimatedEarnings, activity, compliance } = partner;

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/partners"
          className="text-xs font-semibold text-[var(--color-text-muted)] hover:underline"
        >
          ← All partners
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold">{profile.name}</h1>
            <Badge tone={STATUS_TONES[profile.status] ?? 'neutral'}>
              {humanise(profile.status)}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            <span className="font-mono">{profile.reference}</span> · {humanise(profile.type)}
            {profile.city ? ` · ${profile.city}` : ''}
            {profile.onboardedAt ? ` · Partner since ${formatDate(profile.onboardedAt)}` : ''}
          </p>
        </div>
      </header>

      <section aria-label="Business">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Leads sourced"
            value={formatNumber(business.leadsSourced)}
            hint={`${business.leadsOpen} still open`}
          />
          <StatTile
            label="Converted"
            value={formatNumber(business.leadsConverted)}
            hint={`${business.conversionRate}% conversion`}
          />
          <StatTile
            label="Clients"
            value={formatNumber(business.clientsTotal)}
            hint={`${business.clientsActive} active · ${business.clientsOnboarding} onboarding`}
          />
          <StatTile
            label="Leads (30 days)"
            value={formatNumber(activity.leadsLast30)}
            hint={`${activity.conversionsLast30} converted`}
          />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-3">
        <section className="card p-5 xl:col-span-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-bold">Estimated earnings</h2>
            <Badge tone="amber">Estimate</Badge>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-[var(--color-text-muted)]">Attributed business</p>
              <p className="mt-0.5 text-xl font-bold tnum">
                {formatCompactCurrency(estimatedEarnings.attributedBusinessValue)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--color-text-muted)]">Revenue share</p>
              <p className="mt-0.5 text-xl font-bold tnum">
                {estimatedEarnings.commissionRatePercent
                  ? `${estimatedEarnings.commissionRatePercent}%`
                  : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--color-text-muted)]">Indicative commission</p>
              <p className="mt-0.5 text-xl font-bold tnum">
                {formatCompactCurrency(estimatedEarnings.estimatedCommission)}
              </p>
            </div>
          </div>

          <p className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
            {estimatedEarnings.basis}
          </p>
        </section>

        <section className="card p-5">
          <h2 className="font-bold">Contact</h2>
          <dl className="mt-3 space-y-2.5 text-sm">
            <Detail label="Contact person" value={profile.contactPerson} />
            <Detail label="Email" value={profile.email} />
            {/* Masked, the same as everywhere else. A directory screen is not a
                reason to hand out a full mobile number. */}
            <Detail label="Mobile" value={profile.mobileMasked} mono />
            <Detail label="State" value={profile.state} />
          </dl>
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="card p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="font-bold">Sourced leads</h2>
            {leads.total > 0 ? (
              <Link
                href={`/leads?partnerId=${id}`}
                className="text-xs font-semibold text-teal-600 hover:underline dark:text-teal-300"
              >
                View all {leads.total}
              </Link>
            ) : null}
          </div>

          {leads.items.length === 0 ? (
            <EmptyState
              title="No leads sourced yet"
              description="Leads attributed to this partner will appear here."
            />
          ) : (
            <ul className="mt-3 divide-y divide-[var(--color-border)]">
              {leads.items.map((lead) => (
                <li key={lead.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link
                      href={`/leads/${lead.id}`}
                      className="truncate text-sm font-semibold hover:text-teal-600 hover:underline dark:hover:text-teal-300"
                    >
                      {lead.fullName}
                    </Link>
                    <p className="truncate font-mono text-xs text-[var(--color-text-subtle)]">
                      {lead.reference} · {lead.mobileMasked}
                    </p>
                  </div>
                  <LeadStatusBadge status={lead.status} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <h2 className="font-bold">Compliance</h2>
          <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
            What is on file. Verification itself is operations’ record, not this screen’s.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            <ComplianceRow label="PAN on file" ok={compliance.hasPan} />
            <ComplianceRow label="GSTIN on file" ok={compliance.hasGstin} />
            <ComplianceRow
              label="SEBI registration"
              ok={compliance.hasSebiRegistration}
              detail={profile.sebiRegNo ?? undefined}
            />
            <ComplianceRow
              label="Documents uploaded"
              ok={compliance.documentCount > 0}
              detail={`${compliance.documentCount} on file`}
            />
          </ul>
        </section>
      </div>
    </div>
  );
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs text-[var(--color-text-muted)]">{label}</dt>
      <dd className={`mt-0.5 ${mono ? 'font-mono tnum' : ''}`}>{value ?? '—'}</dd>
    </div>
  );
}

function ComplianceRow({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean;
  detail?: string;
}) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className="flex items-center gap-2 text-xs">
        {detail ? <span className="text-[var(--color-text-muted)]">{detail}</span> : null}
        {/* Word as well as colour — the tick alone is invisible to a screen
            reader and ambiguous to anyone with a colour vision deficiency. */}
        <Badge tone={ok ? 'green' : 'amber'}>{ok ? 'On file' : 'Missing'}</Badge>
      </span>
    </li>
  );
}
