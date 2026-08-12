import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { DuplicateGroup } from '@sihl-one/contracts';

import { DuplicateGroupCard } from '@/components/duplicates/DuplicateGroupCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/shell/Icon';
import { apiFetch, toQuery } from '@/lib/api';
import { can, requireUser } from '@/lib/auth';
import { formatNumber } from '@/lib/format';

export const metadata = { title: 'Duplicate leads' };

const KEYS = [
  { value: 'ANY', label: 'All' },
  { value: 'MOBILE', label: 'Same mobile' },
  { value: 'EMAIL', label: 'Same email' },
  { value: 'PAN', label: 'Same PAN' },
] as const;

export default async function DuplicatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user, 'lead:update')) redirect('/leads');

  const params = await searchParams;
  const key = params.key ?? 'ANY';

  const data = await apiFetch<{
    items: DuplicateGroup[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/duplicates${toQuery({ key, page: params.page ?? '1', pageSize: '20' })}`);

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/leads"
          className="text-xs font-semibold text-[var(--color-text-muted)] hover:underline"
        >
          ← All leads
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-bold">Duplicate leads</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Records sharing an exact mobile, email or PAN — within your data scope. Same person,
          more than one record, usually more than one owner.
        </p>
      </header>

      <div className="card flex flex-wrap gap-2 p-3">
        {KEYS.map((option) => (
          <Link
            key={option.value}
            href={option.value === 'ANY' ? '/leads/duplicates' : `/leads/duplicates?key=${option.value}`}
            className={`h-9 rounded-lg border px-3 text-xs font-semibold leading-9 transition-colors ${
              key === option.value
                ? 'border-teal-500 bg-teal-500 text-white'
                : 'border-[var(--color-border-strong)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]'
            }`}
          >
            {option.label}
          </Link>
        ))}
      </div>

      {data.items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Icon name="check" size={40} />}
            title="No duplicates found"
            description="No two leads in your scope share a mobile number, email or PAN."
          />
        </div>
      ) : (
        <>
          <p className="text-sm text-[var(--color-text-muted)]">
            {formatNumber(data.total)} {data.total === 1 ? 'group' : 'groups'} to review
          </p>
          <ul className="space-y-4">
            {data.items.map((group) => (
              <DuplicateGroupCard key={group.leads.map((lead) => lead.id).join(':')} group={group} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
