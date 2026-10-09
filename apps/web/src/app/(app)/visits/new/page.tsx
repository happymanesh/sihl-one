import Link from 'next/link';
import type { LeadListItem, MeetingModeItem } from '@sihl-one/contracts';

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
  /*
    Arriving from one lead means that lead, and nothing else.

    The picker offered fifty others, which is a chance to plan the visit
    against the wrong client for no benefit — the choice was already made by
    pressing "Plan a field visit" on a particular record. It also fixes a
    quieter fault: the list is the first fifty open leads, so a preset lead
    outside that page was not in the dropdown at all and the form opened with
    nothing selected.
  */
  const presetLeadId = preset.entityType === 'LEAD' && preset.entityId ? preset.entityId : null;
  const presetLead = presetLeadId
    ? await apiFetch<{ id: string; fullName: string; reference: string; city: string | null }>(
        `/leads/${presetLeadId}`,
      ).catch(() => null)
    : null;

  const [leads, customers, meetingModes, colleagues] = await Promise.all([
    // Skipped entirely when one lead is already chosen — fifty rows nobody
    // will look at is a request worth not making.
    presetLead
      ? Promise.resolve({ items: [] as LeadListItem[] })
      : apiFetch<{ items: LeadListItem[] }>(
          // Every open stage, NEW included.
          //
          // This used to start at CONTACTED, on the reasoning that you do not visit
          // somebody you have never spoken to. Per-product outcomes broke that: a
          // lead whose only remaining open product sits at NEW rolls up to NEW, so a
          // client mid-conversation about F&O disappeared from this list the moment
          // their equity converted. The stage a lead happens to be at is a poor
          // reason to refuse to plan a meeting with them.
          '/leads?pageSize=50&status=NEW&status=CONTACTED&status=QUALIFIED&status=PROPOSAL',
        ).catch(() => ({ items: [] as LeadListItem[] })),
    apiFetch<{ items: CustomerRow[] }>('/customers?pageSize=50').catch(() => ({
      items: [] as CustomerRow[],
    })),
    // An empty list hides the selector rather than blocking the form: planning
    // a visit must not fail because a master could not be read.
    apiFetch<MeetingModeItem[]>('/masters/meeting-modes').catch(() => [] as MeetingModeItem[]),
    apiFetch<Array<{ id: string; fullName: string; employeeCode?: string | null }>>(
      // The attendee picker has its own endpoint and its own rule. It is not
      // the owner picker: who you may *bring* is a wider and much lighter
      // question than who you may hand a client to.
      '/users/colleagues',
    ).catch(() => []),
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
          colleagues={colleagues}
          meetingModes={meetingModes}
          leads={(presetLead ? [presetLead] : leads.items).map((lead) => ({
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
