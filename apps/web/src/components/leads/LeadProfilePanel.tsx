'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ANNUAL_INCOME_LABELS,
  EXISTING_INVESTMENT_LABELS,
  FAMILY_RELATION_LABELS,
  hasProfileContent,
  MEDICLAIM_LABELS,
  RISK_LABELS,
  type LeadProfileView,
} from '@sihl-one/contracts';

import { updateLeadProfile, type ActionState } from '@/app/actions/leads';
import { LeadProfileFields } from '@/components/leads/LeadProfileFields';
import { formatCurrency } from '@/lib/format';

const INITIAL: ActionState = { status: 'idle' };

/**
 * The client profile on the lead record: read it, or open it and edit.
 *
 * This is where the profile actually gets filled in. Almost nobody knows a
 * prospect's income at the moment the lead is created — it arrives across
 * several conversations — so the capture form offers the section and this is
 * where it is returned to.
 */
export function LeadProfilePanel({
  leadId,
  profile,
  canEdit,
}: {
  leadId: string;
  profile: LeadProfileView | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [state, action] = useActionState(updateLeadProfile, INITIAL);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (state.status === 'success') {
      setEditing(false);
      router.refresh();
    }
  }, [state.status, router]);

  const filled = hasProfileContent(profile);

  if (editing) {
    return (
      <section className="card p-5">
        <h2 className="font-bold">Additional information</h2>

        <form action={action} className="mt-3 space-y-3">
          <input type="hidden" name="leadId" value={leadId} />

          {state.status === 'error' && state.message ? (
            <p role="alert" className="rounded-lg border border-danger-500/40 bg-danger-50 px-3 py-2 text-sm text-danger-600 dark:bg-danger-500/15">
              {state.message}
            </p>
          ) : null}

          <LeadProfileFields profile={profile} />

          <div className="flex gap-2">
            <button type="submit" className="btn btn-accent h-9 px-4 text-sm">Save</button>
            <button type="button" onClick={() => setEditing(false)} className="btn btn-outline h-9 px-4 text-sm">
              Cancel
            </button>
          </div>
        </form>
      </section>
    );
  }

  return (
    <section className="card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-bold">Additional information</h2>
          {!filled ? (
            <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
              Nothing recorded yet. Occupation, income, existing investments and family.
            </p>
          ) : null}
        </div>
        {canEdit ? (
          <button type="button" onClick={() => setEditing(true)} className="btn btn-outline h-8 px-3 text-xs">
            {filled ? 'Edit' : 'Add'}
          </button>
        ) : null}
      </div>

      {filled && profile ? (
        <>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <Row label="Occupation" value={[profile.occupation, profile.designation, profile.companyName].filter(Boolean).join(' · ')} />
            <Row label="Risk appetite" value={profile.riskCategory ? RISK_LABELS[profile.riskCategory] : null} />
            <Row label="Annual income" value={profile.annualIncomeBand ? ANNUAL_INCOME_LABELS[profile.annualIncomeBand] : null} />
            <Row label="Monthly income" value={money(profile.monthlyIncome)} />
            <Row label="Monthly SIP" value={money(profile.monthlySip)} />
            <Row label="Monthly EMI" value={money(profile.monthlyEmi)} />
            <Row label="Life cover" value={money(profile.insuranceCover)} />
            <Row label="Mediclaim" value={profile.mediclaimBand ? MEDICLAIM_LABELS[profile.mediclaimBand] : null} />
            <Row label="Goal" value={profile.investmentGoal} />
            <Row label="Other" value={profile.otherInvestments} />
          </dl>

          {profile.existingInvestments.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs text-[var(--color-text-muted)]">Existing investments</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {profile.existingInvestments.map((code) => (
                  <span key={code} className="rounded-full bg-[var(--color-surface-muted)] px-2.5 py-0.5 text-xs font-semibold">
                    {EXISTING_INVESTMENT_LABELS[code]}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {profile.familyMembers.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs text-[var(--color-text-muted)]">Family</p>
              <ul className="mt-1 space-y-1 text-sm">
                {profile.familyMembers.map((member) => (
                  <li key={member.id}>
                    <span className="font-medium">{FAMILY_RELATION_LABELS[member.relation]}</span>
                    {member.name ? ` — ${member.name}` : ''}
                    <span className="text-[var(--color-text-muted)]">
                      {[member.occupation, member.location, member.maritalStatus === 'MARRIED' ? 'Married' : member.maritalStatus === 'UNMARRIED' ? 'Unmarried' : null]
                        .filter(Boolean)
                        .map((part) => ` · ${part}`)
                        .join('')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <p className="mt-3 text-xs text-[var(--color-text-subtle)]">
            What the client told us. Verified figures come from the back office and KYC.
          </p>
        </>
      ) : null}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs text-[var(--color-text-muted)]">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

/** Blank stays blank: a missing income must not render as ₹0. */
function money(value: string | null): string | null {
  return value ? formatCurrency(value) : null;
}
