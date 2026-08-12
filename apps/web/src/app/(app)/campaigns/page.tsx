import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { CampaignListItem } from '@sihl-one/contracts';

import { Badge } from '@/components/ui/Badge';
import { CampaignFilters } from '@/components/campaigns/CampaignFilters';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/shell/Icon';
import { Pagination } from '@/components/ui/Pagination';
import { apiFetch, toQuery } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';
import { formatCompactCurrency, formatDate, formatNumber, humanise } from '@/lib/format';

export const metadata = { title: 'Campaigns' };

const STATUS_TONES: Record<string, 'green' | 'teal' | 'amber' | 'navy' | 'neutral'> = {
  DRAFT: 'neutral',
  SCHEDULED: 'navy',
  RUNNING: 'green',
  PAUSED: 'amber',
  COMPLETED: 'teal',
  ARCHIVED: 'neutral',
};

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  // Guarded here as well as in the nav: a permission check that only exists
  // in the menu is one somebody can navigate around, and a raw 403 renders as
  // the generic error card rather than as "you do not have access".
  if (!can(user, 'campaign:read')) redirect('/dashboard');

  const params = await searchParams;

  const data = await apiFetch<{
    items: CampaignListItem[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  }>(
    `/campaigns${toQuery({
      q: params.q,
      status: params.status,
      channel: params.channel,
      page: params.page ?? '1',
      pageSize: '20',
    })}`,
  );

  const isFiltered = Boolean(params.q || params.status || params.channel);
  const canCreate = can(user, 'campaign:create');

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Campaigns</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {formatNumber(data.total)} {data.total === 1 ? 'campaign' : 'campaigns'} · leads are
            attributed automatically from the tracking link
          </p>
        </div>
        {canCreate ? (
          <Link href="/campaigns/new" className="btn btn-primary">
            <Icon name="plus" size={16} />
            New campaign
          </Link>
        ) : null}
      </header>

      <CampaignFilters />

      {data.items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Icon name="megaphone" size={40} />}
            title={isFiltered ? 'No campaigns match those filters' : 'No campaigns yet'}
            description={
              isFiltered
                ? 'Try widening the search, or clear the filters.'
                : 'A campaign gives spend a name, and gives every lead it produces somewhere to be counted.'
            }
            action={
              isFiltered ? (
                <Link href="/campaigns" className="btn btn-outline">
                  Clear filters
                </Link>
              ) : canCreate ? (
                <Link href="/campaigns/new" className="btn btn-primary">
                  Create the first campaign
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <div className="card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] text-left">
                  <tr>
                    {['Campaign', 'Status', 'Channels', 'Leads', 'Converted', 'Spend', 'Runs'].map(
                      (heading) => (
                        <th
                          key={heading}
                          scope="col"
                          className="px-4 py-2.5 text-xs font-bold uppercase tracking-wide text-[var(--color-text-muted)]"
                        >
                          {heading}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {data.items.map((campaign) => (
                    <tr key={campaign.id} className="hover:bg-[var(--color-surface-muted)]">
                      <td className="px-4 py-3">
                        <Link
                          href={`/campaigns/${campaign.id}`}
                          className="font-semibold hover:text-teal-600 hover:underline dark:hover:text-teal-300"
                        >
                          {campaign.name}
                        </Link>
                        <div className="mt-0.5 font-mono text-xs text-[var(--color-text-subtle)]">
                          {campaign.code}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={STATUS_TONES[campaign.status] ?? 'neutral'}>
                          {humanise(campaign.status)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                        {campaign.channels.map((channel) => humanise(channel)).join(', ')}
                      </td>
                      <td className="px-4 py-3 tnum">{formatNumber(campaign.leads)}</td>
                      <td className="px-4 py-3 tnum">
                        {formatNumber(campaign.converted)}
                        {/* Parenthesised: "1" beside "11.1%" reads as "111.1%"
                            at a glance, and as exactly that to a screen reader. */}
                        <span className="ml-1.5 text-xs text-[var(--color-text-subtle)]">
                          ({campaign.conversionRate}%)
                        </span>
                      </td>
                      <td className="px-4 py-3 tnum text-xs">
                        {/* Spend, not budget. What was committed matters less
                            than what has actually gone out. */}
                        {campaign.actualSpend ? (
                          formatCompactCurrency(campaign.actualSpend)
                        ) : (
                          <span className="text-[var(--color-text-subtle)]">Not recorded</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                        {campaign.startsAt ? formatDate(campaign.startsAt) : '—'}
                        {campaign.endsAt ? ` → ${formatDate(campaign.endsAt)}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
