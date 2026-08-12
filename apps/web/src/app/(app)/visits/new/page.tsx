import Link from 'next/link';
import type { LeadListItem } from '@sihl-one/contracts';

import { PlanVisitForm } from '@/components/visits/PlanVisitForm';
import { apiFetch } from '@/lib/api';
import { requireUser } from '@/lib/auth';

export const metadata = { title: 'Plan a visit' };

interface CustomerRow {
  id: string;
  fullName: string;
  reference: string;
  city: string | null;
}

export default async function PlanVisitPage({
  searchParams,
}: {
  searchParams: Promise<{ entityType?: string; entityId?: string }>;
}) {
  await requireUser();
  const preset = await searchParams;

  // Only the records the caller can actually visit are offered. Pulling the
  // whole book and filtering in the browser would both leak names and be slow.
  const [leads, customers] = await Promise.all([
    apiFetch<{ items: LeadListItem[] }>(
      '/leads?pageSize=50&status=CONTACTED&status=QUALIFIED&status=PROPOSAL',
    ).catch(() => ({ items: [] as LeadListItem[] })),
    apiFetch<{ items: CustomerRow[] }>('/customers?pageSize=50').catch(() => ({
      items: [] as CustomerRow[],
    })),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <nav className="text-xs text-[var(--color-text-muted)]">
        <Link href="/visits" className="hover:underline">
          Visits
        </Link>
        <span className="mx-1.5" aria-hidden>
          /
        </span>
        <span>Plan</span>
      </nav>

      <header>
        <h1 className="text-2xl font-bold">Plan a visit</h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Pick who you are seeing and why. You will check in when you arrive.
        </p>
      </header>

      <div className="card p-5">
        <PlanVisitForm
          leads={leads.items.map((lead) => ({
            id: lead.id,
            label: `${lead.fullName} — ${lead.reference}${lead.city ? ` (${lead.city})` : ''}`,
          }))}
          customers={customers.items.map((customer) => ({
            id: customer.id,
            label: `${customer.fullName} — ${customer.reference}${customer.city ? ` (${customer.city})` : ''}`,
          }))}
          presetEntityType={preset.entityType}
          presetEntityId={preset.entityId}
        />
      </div>
    </div>
  );
}
