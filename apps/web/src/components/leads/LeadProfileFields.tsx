'use client';

import { useState } from 'react';
import {
  ANNUAL_INCOME_BANDS,
  ANNUAL_INCOME_LABELS,
  EXISTING_INVESTMENT_LABELS,
  EXISTING_INVESTMENTS,
  FAMILY_RELATION_LABELS,
  FAMILY_RELATIONS,
  MARITAL_STATUSES,
  MEDICLAIM_BANDS,
  MEDICLAIM_LABELS,
  RISK_CATEGORIES,
  RISK_LABELS,
  type LeadProfileView,
} from '@sihl-one/contracts';

/**
 * The client profile, as an optional section of the lead form.
 *
 * Collapsed by default, and that is the important decision. Most leads are
 * created in the twenty seconds after a phone call ends, from a name and a
 * number; putting fourteen more fields in that path would either slow every
 * capture down or get them filled with guesses. This opens when a rep actually
 * has something to record.
 *
 * Nothing here is required. A blank field means "not known yet", which is the
 * truth for almost every lead on the day it arrives.
 */
export function LeadProfileFields({ profile }: { profile?: LeadProfileView | null }) {
  const [open, setOpen] = useState(Boolean(profile?.occupation || profile?.familyMembers?.length));
  const [family, setFamily] = useState<number[]>(
    profile?.familyMembers?.length ? profile.familyMembers.map((_, index) => index) : [],
  );

  return (
    <fieldset className="rounded-lg border border-[var(--color-border)]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span>
          <span className="text-sm font-bold">Additional information</span>
          <span className="ml-2 text-xs text-[var(--color-text-subtle)]">Optional</span>
          <span className="mt-0.5 block text-xs text-[var(--color-text-subtle)]">
            Occupation, income, existing investments and family. Fill in whatever you know.
          </span>
        </span>
        <span aria-hidden className="text-xs text-[var(--color-text-muted)]">
          {open ? 'Hide' : 'Show'}
        </span>
      </button>

      {open ? (
        <div className="space-y-4 border-t border-[var(--color-border)] p-4">
          {/* --- work ------------------------------------------------------ */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="profile.occupation">Occupation</label>
              <input id="profile.occupation" name="profile.occupation" className="input"
                defaultValue={profile?.occupation ?? ''} placeholder="Chartered Accountant" />
            </div>
            <div>
              <label className="label" htmlFor="profile.companyName">Company</label>
              <input id="profile.companyName" name="profile.companyName" className="input"
                defaultValue={profile?.companyName ?? ''} />
            </div>
            <div>
              <label className="label" htmlFor="profile.designation">Position</label>
              <input id="profile.designation" name="profile.designation" className="input"
                defaultValue={profile?.designation ?? ''} />
            </div>
          </div>

          {/* --- money ----------------------------------------------------- */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="profile.riskCategory">Risk appetite</label>
              <select id="profile.riskCategory" name="profile.riskCategory" className="input"
                defaultValue={profile?.riskCategory ?? ''}>
                <option value="">Not recorded</option>
                {RISK_CATEGORIES.map((value) => (
                  <option key={value} value={value}>{RISK_LABELS[value]}</option>
                ))}
              </select>
              {/* Said plainly, because the word "risk" in a broker's system
                  invites the assumption that this is the regulated assessment. */}
              <p className="mt-1 text-xs text-[var(--color-text-subtle)]">
                The client&rsquo;s own sense of it. Not a suitability assessment.
              </p>
            </div>
            <div>
              <label className="label" htmlFor="profile.annualIncomeBand">Annual income</label>
              <select id="profile.annualIncomeBand" name="profile.annualIncomeBand" className="input"
                defaultValue={profile?.annualIncomeBand ?? ''}>
                <option value="">Not recorded</option>
                {ANNUAL_INCOME_BANDS.map((value) => (
                  <option key={value} value={value}>{ANNUAL_INCOME_LABELS[value]}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Money id="profile.monthlyIncome" label="Monthly income" value={profile?.monthlyIncome} />
            <Money id="profile.monthlySip" label="Monthly SIP" value={profile?.monthlySip} />
            <Money id="profile.monthlyEmi" label="Monthly EMI" value={profile?.monthlyEmi} />
          </div>

          <div>
            <label className="label" htmlFor="profile.investmentGoal">Investment goal</label>
            <input id="profile.investmentGoal" name="profile.investmentGoal" className="input"
              defaultValue={profile?.investmentGoal ?? ''}
              placeholder="Retirement at 55, daughter&rsquo;s education" />
          </div>

          {/* --- what they already hold ------------------------------------ */}
          <div>
            <span className="label">Existing investments</span>
            <div className="flex flex-wrap gap-1.5">
              {EXISTING_INVESTMENTS.map((value) => (
                <label key={value}
                  className="cursor-pointer rounded-lg border border-[var(--color-border-strong)] px-2.5 py-1 text-xs font-semibold transition-colors has-[:checked]:border-teal-500 has-[:checked]:bg-teal-500 has-[:checked]:text-white">
                  <input type="checkbox" name="profile.existingInvestments" value={value}
                    defaultChecked={profile?.existingInvestments?.includes(value)}
                    aria-label={EXISTING_INVESTMENT_LABELS[value]} className="sr-only" />
                  {EXISTING_INVESTMENT_LABELS[value]}
                </label>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Money id="profile.insuranceCover" label="Life cover" value={profile?.insuranceCover} />
            <div>
              <label className="label" htmlFor="profile.mediclaimBand">Mediclaim</label>
              <select id="profile.mediclaimBand" name="profile.mediclaimBand" className="input"
                defaultValue={profile?.mediclaimBand ?? ''}>
                <option value="">Not recorded</option>
                {MEDICLAIM_BANDS.map((value) => (
                  <option key={value} value={value}>{MEDICLAIM_LABELS[value]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="profile.otherInvestments">Other</label>
              <input id="profile.otherInvestments" name="profile.otherInvestments" className="input"
                defaultValue={profile?.otherInvestments ?? ''} placeholder="Property, gold" />
            </div>
          </div>

          {/* --- household -------------------------------------------------- */}
          <div>
            <span className="label">Family members</span>

            <div className="space-y-2">
              {family.map((key, index) => {
                const member = profile?.familyMembers?.[index];
                return (
                  <div key={key} className="grid gap-2 sm:grid-cols-[7rem_1fr_1fr_1fr_8rem_2rem]">
                    <select name="family.relation" className="input h-9 text-xs"
                      defaultValue={member?.relation ?? 'SPOUSE'} aria-label="Relation">
                      {FAMILY_RELATIONS.map((value) => (
                        <option key={value} value={value}>{FAMILY_RELATION_LABELS[value]}</option>
                      ))}
                    </select>
                    <input name="family.name" className="input h-9 text-xs" placeholder="Name"
                      aria-label="Name" defaultValue={member?.name ?? ''} />
                    <input name="family.occupation" className="input h-9 text-xs" placeholder="Occupation"
                      aria-label="Occupation" defaultValue={member?.occupation ?? ''} />
                    <input name="family.location" className="input h-9 text-xs" placeholder="Location"
                      aria-label="Location" defaultValue={member?.location ?? ''} />
                    <select name="family.maritalStatus" className="input h-9 text-xs"
                      defaultValue={member?.maritalStatus ?? ''} aria-label="Marital status">
                      <option value="">—</option>
                      {MARITAL_STATUSES.map((value) => (
                        <option key={value} value={value}>
                          {value === 'MARRIED' ? 'Married' : 'Unmarried'}
                        </option>
                      ))}
                    </select>
                    <button type="button"
                      onClick={() => setFamily((rows) => rows.filter((row) => row !== key))}
                      aria-label="Remove this family member"
                      className="h-9 rounded-lg border border-[var(--color-border-strong)] text-xs text-[var(--color-text-muted)] hover:text-danger-500">
                      &times;
                    </button>
                  </div>
                );
              })}
            </div>

            <button type="button"
              onClick={() => setFamily((rows) => [...rows, (rows.at(-1) ?? -1) + 1])}
              className="btn btn-outline mt-2 h-8 px-3 text-xs">
              Add family member
            </button>
          </div>
        </div>
      ) : null}
    </fieldset>
  );
}

/**
 * A rupee field.
 *
 * `inputMode="decimal"` rather than `type="number"`: a number input on Android
 * hides the decimal point on some keyboards and silently accepts the scientific
 * notation a stray "e" produces. The value is validated as a string anyway.
 */
function Money({ id, label, value }: { id: string; label: string; value?: string | null }) {
  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <div className="flex items-center gap-1">
        <span className="text-xs text-[var(--color-text-subtle)]">&#8377;</span>
        <input id={id} name={id} inputMode="decimal" className="input tnum"
          defaultValue={value ?? ''} placeholder="Optional" />
      </div>
    </div>
  );
}
