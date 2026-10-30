import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { LeadListItem, Partner360 } from '@sihl-one/contracts';

import { Badge, LeadStatusBadge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/shell/Icon';
import { PartnerPortalPicker } from '@/components/partner/PartnerPortalPicker';
import { ReferralCard, type ReferralLink } from '@/components/partner/ReferralCard';
import { StatTile } from '@/components/ui/StatTile';
import { apiFetch } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { formatCompactCurrency, formatDate, formatNumber, humanise } from '@/lib/format';

export const metadata = { title: 'Partner portal' };

interface CustomerRow {
  id: string;
  reference: string;
  fullName: string;
  onboardingStage: string;
  progressPercent: number;
  kycStatus: string;
  status: string;
}

/**
 * Associate partner portal.
 *
 * Everything here is already scoped server-side by `partnerId`, so this page
 * makes the same calls a staff member would and simply gets a smaller answer.
 * Building a parallel set of partner-only endpoints would have meant a second
 * place for the scoping rules to be wrong.
 */
export default async function PartnerPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ partnerId?: string }>;
}) {
  const user = await requireUser();

  /*
    Two readers, one page.

    A partner sees their own portal, which is the whole point of it. A super
    admin sees whichever partner they pick, so support can answer "what does
    this partner actually see" — a question the Partners directory cannot
    answer, because that shows the firm as SIHL sees it rather than the
    referral link and lead list the partner logs in to.

    Nobody else reaches it. Management used to see the menu entry and be
    bounced straight back to the Dashboard, which is why it looked like a
    duplicate of it.
  */
  const isPartner = user.roles.includes('PARTNER');
  const isSuperAdmin = user.roles.includes('SUPER_ADMIN');
  if (!isPartner && !isSuperAdmin) redirect('/dashboard');

  const params = await searchParams;

  // A partner's own id is never read from the URL: `/partners/me` is the only
  // thing that decides whose portal a partner sees.
  const viewingId = isPartner ? null : (params.partnerId ?? null);

  const directory = isPartner
    ? []
    : // 100 is the cap the API enforces; asking for more is a validation
      // error, not a larger page.
      await apiFetch<Array<{ id: string; name: string }>>('/partners?pageSize=100')
        .then((rows) => (Array.isArray(rows) ? rows : ((rows as { items?: [] }).items ?? [])))
        .catch(() => []);

  // Super admin before they have chosen: the picker and nothing else. There
  // is no portal to show yet, and an empty one would read as a broken page.
  if (!isPartner && !viewingId) {
    return (
      <div className="space-y-4">
        <header>
          <h1 className="text-2xl font-bold">Partner portal</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            Pick a partner to see their own view of SIHL ONE.
          </p>
        </header>
        <PartnerPortalPicker partners={directory} />
      </div>
    );
  }

  const base = isPartner ? '/partners/me' : `/partners/${viewingId}`;
  // Scoped to the partner being viewed. A super admin's own scope is
  // everything, so without this they would see the whole book under a
  // partner's name.
  const scope = isPartner ? '' : `&partnerId=${viewingId}`;

  const [partner, leads, clients, referral] = await Promise.all([
    apiFetch<Partner360>(base),
    apiFetch<{ items: LeadListItem[]; total: number }>(`/leads?pageSize=10${scope}`),
    apiFetch<{ items: CustomerRow[]; total: number }>(`/customers?pageSize=10${scope}`),
    // Issued on first request. Degrades to nothing rather than taking the whole
    // portal down if it cannot be minted.
    apiFetch<ReferralLink>(`${base}/referral-link`).catch(() => null),
  ]);

  return (
    <div className="space-y-6">
      {!isPartner ? (
        <PartnerPortalPicker partners={directory} selectedId={viewingId ?? undefined} />
      ) : null}

      <header>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-bold">{partner.profile.name}</h1>
          <Badge tone={partner.profile.status === 'ACTIVE' ? 'green' : 'amber'}>
            {humanise(partner.profile.status)}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {humanise(partner.profile.type)}
          {partner.profile.sebiRegNo ? ` · SEBI ${partner.profile.sebiRegNo}` : ''}
          {partner.profile.onboardedAt
            ? ` · Partner since ${formatDate(partner.profile.onboardedAt)}`
            : ''}
        </p>
      </header>

      <section aria-label="Business">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Leads sourced"
            value={formatNumber(partner.business.leadsSourced)}
            hint={`${partner.business.leadsOpen} still open`}
          />
          <StatTile
            label="Converted"
            value={formatNumber(partner.business.leadsConverted)}
            hint={`${partner.business.conversionRate}% conversion`}
          />
          <StatTile
            label="Clients"
            value={formatNumber(partner.business.clientsTotal)}
            hint={`${partner.business.clientsActive} active · ${partner.business.clientsOnboarding} onboarding`}
          />
          <StatTile
            label="Leads (30 days)"
            value={formatNumber(partner.activity.leadsLast30)}
            hint={`${partner.activity.conversionsLast30} converted`}
          />
        </div>
      </section>

      {referral ? <ReferralCard link={referral} /> : null}

      <section className="card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-bold">Estimated earnings</h2>
          <Badge tone="amber">Estimate</Badge>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-[var(--color-text-muted)]">Attributed business</p>
            <p className="mt-0.5 text-xl font-bold tnum">
              {formatCompactCurrency(partner.estimatedEarnings.attributedBusinessValue)}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--color-text-muted)]">Revenue share</p>
            <p className="mt-0.5 text-xl font-bold tnum">
              {partner.estimatedEarnings.commissionRatePercent
                ? `${partner.estimatedEarnings.commissionRatePercent}%`
                : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--color-text-muted)]">Indicative commission</p>
            <p className="mt-0.5 text-xl font-bold tnum">
              {formatCompactCurrency(partner.estimatedEarnings.estimatedCommission)}
            </p>
          </div>
        </div>

        {/*
          Stated plainly rather than buried in a tooltip. SIHL ONE is not the
          system of record for money — presenting its own arithmetic as an
          amount payable is how a partner dispute starts.
        */}
        <p className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2 text-xs text-[var(--color-text-muted)]">
          {partner.estimatedEarnings.basis}
        </p>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="card p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="font-bold">Your leads</h2>
            <Link
              href="/leads"
              className="text-xs font-semibold text-teal-600 hover:underline dark:text-teal-300"
            >
              View all {leads.total}
            </Link>
          </div>

          {leads.items.length === 0 ? (
            <EmptyState
              title="No leads yet"
              description="Leads you source will appear here as soon as they are captured."
            />
          ) : (
            <ul className="mt-3 divide-y divide-[var(--color-border)]">
              {leads.items.map((lead) => (
                <li key={lead.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{lead.fullName}</p>
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
          <div className="flex items-baseline justify-between">
            <h2 className="font-bold">Your clients</h2>
            <Link
              href="/customers"
              className="text-xs font-semibold text-teal-600 hover:underline dark:text-teal-300"
            >
              View all {clients.total}
            </Link>
          </div>

          {clients.items.length === 0 ? (
            <EmptyState
              title="No clients yet"
              description="Converted leads become clients and appear here."
            />
          ) : (
            <ul className="mt-3 divide-y divide-[var(--color-border)]">
              {clients.items.map((client) => (
                <li key={client.id} className="py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-semibold">{client.fullName}</p>
                    <span className="shrink-0 text-xs text-[var(--color-text-muted)]">
                      {humanise(client.onboardingStage)}
                    </span>
                  </div>
                  <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-[var(--color-surface-inset)]">
                    <span
                      className="block h-full rounded-full bg-teal-500"
                      style={{ width: `${client.progressPercent}%` }}
                    />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card p-5">
        <h2 className="font-bold">Compliance</h2>
        <p className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
          Keep these current to avoid interruptions to payouts.
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ['PAN on file', partner.compliance.hasPan],
            ['GSTIN on file', partner.compliance.hasGstin],
            ['SEBI registration', partner.compliance.hasSebiRegistration],
            ['Documents uploaded', partner.compliance.documentCount > 0],
          ].map(([label, ok]) => (
            <li
              key={label as string}
              className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
                  ok ? 'bg-teal-500' : 'bg-warn-500'
                }`}
                aria-hidden
              >
                {ok ? '✓' : '!'}
              </span>
              <span>{label as string}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="flex items-center gap-2 text-xs text-[var(--color-text-subtle)]">
        <Icon name="shield" size={14} />
        You are seeing only the business you sourced. Contact your SIHL relationship manager for
        anything else.
      </p>
    </div>
  );
}
