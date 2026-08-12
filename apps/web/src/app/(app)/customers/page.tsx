import Link from 'next/link';

import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/shell/Icon';
import { KycBadge } from '@/components/ui/Badge';
import { Pagination } from '@/components/ui/Pagination';
import { apiFetch, toQuery } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { formatDate, formatNumber, humanise } from '@/lib/format';

export const metadata = { title: 'Customers' };

interface CustomerRow {
  id: string;
  reference: string;
  clientCode: string | null;
  fullName: string;
  email: string;
  mobileMasked: string;
  city: string | null;
  status: string;
  kycStatus: string;
  onboardingStage: string;
  progressPercent: number;
  relationshipManager: { id: string; fullName: string } | null;
  createdAt: string;
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireUser();
  const params = await searchParams;

  const data = await apiFetch<{
    items: CustomerRow[];
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  }>(
    `/customers${toQuery({
      q: params.q,
      status: params.status,
      kycStatus: params.kycStatus,
      onboardingStage: params.onboardingStage,
      page: params.page ?? '1',
      pageSize: '20',
    })}`,
  );

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Customers</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {formatNumber(data.total)} in your scope
        </p>
      </header>

      {data.items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Icon name="users" size={40} />}
            title="No customers yet"
            description="Customers appear here once a qualified lead is converted."
            action={
              <Link href="/leads?status=QUALIFIED" className="btn btn-primary">
                See qualified leads
              </Link>
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
                    {['Customer', 'Onboarding', 'KYC', 'Relationship manager', 'Since'].map(
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
                  {data.items.map((customer) => (
                    <tr key={customer.id} className="hover:bg-[var(--color-surface-muted)]">
                      <td className="px-4 py-3">
                        <Link
                          href={`/customers/${customer.id}`}
                          className="font-semibold hover:text-teal-600 hover:underline dark:hover:text-teal-300"
                        >
                          {customer.fullName}
                        </Link>
                        <div className="mt-0.5 text-xs text-[var(--color-text-subtle)]">
                          <span className="font-mono">{customer.clientCode ?? customer.reference}</span>
                          <span className="mx-1.5" aria-hidden>·</span>
                          <span className="tnum">{customer.mobileMasked}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {/* Progress bar plus the stage name. The bar alone says
                            "some of the way", which nobody can act on. */}
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-20 overflow-hidden rounded-full bg-[var(--color-surface-inset)]">
                            <span
                              className="block h-full rounded-full bg-teal-500"
                              style={{ width: `${customer.progressPercent}%` }}
                            />
                          </span>
                          <span className="text-xs text-[var(--color-text-muted)]">
                            {humanise(customer.onboardingStage)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <KycBadge status={customer.kycStatus} />
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {customer.relationshipManager?.fullName ?? (
                          <span className="font-semibold text-warn-600">Unassigned</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                        {formatDate(customer.createdAt)}
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
