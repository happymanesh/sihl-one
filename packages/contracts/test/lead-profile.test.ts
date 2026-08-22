import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ANNUAL_INCOME_BANDS,
  ANNUAL_INCOME_LABELS,
  EXISTING_INVESTMENT_LABELS,
  EXISTING_INVESTMENTS,
  FAMILY_RELATION_LABELS,
  FAMILY_RELATIONS,
  hasProfileContent,
  leadProfileSchema,
  MEDICLAIM_BANDS,
  MEDICLAIM_LABELS,
  RISK_CATEGORIES,
  RISK_LABELS,
} from '../src/lead-profile';

describe('client profile input', () => {
  it('accepts an entirely empty profile — nothing here is known on day one', () => {
    assert.equal(leadProfileSchema.safeParse({}).success, true);
  });

  it('accepts a full profile', () => {
    const parsed = leadProfileSchema.safeParse({
      occupation: 'Chartered Accountant',
      companyName: 'Shah & Co',
      riskCategory: 'MEDIUM',
      monthlyIncome: '250000',
      annualIncomeBand: 'TWENTYFIVE_TO_50L',
      existingInvestments: ['FD', 'MUTUAL_FUNDS'],
      mediclaimBand: 'FIVE_TO_10L',
      familyMembers: [{ relation: 'SPOUSE', name: 'Nita', maritalStatus: 'MARRIED' }],
    });
    assert.equal(parsed.success, true);
  });

  it('accepts paise but refuses three decimal places', () => {
    assert.equal(leadProfileSchema.safeParse({ monthlyIncome: '45000.50' }).success, true);
    assert.equal(leadProfileSchema.safeParse({ monthlyIncome: '45000.505' }).success, false);
  });

  it('refuses comma separators, which people type by habit', () => {
    assert.equal(leadProfileSchema.safeParse({ monthlyIncome: '2,50,000' }).success, false);
  });

  it('refuses a negative income', () => {
    assert.equal(leadProfileSchema.safeParse({ monthlyIncome: '-1' }).success, false);
  });

  it('refuses a band nobody defined', () => {
    assert.equal(leadProfileSchema.safeParse({ annualIncomeBand: 'ABOUT_10_CRORE' }).success, false);
  });

  it('caps the household, so a malformed post cannot write thousands of rows', () => {
    const many = Array.from({ length: 13 }, () => ({ relation: 'OTHER' as const }));
    assert.equal(leadProfileSchema.safeParse({ familyMembers: many }).success, false);
  });

  it('requires a relation for a family member — a nameless blank row means nothing', () => {
    assert.equal(leadProfileSchema.safeParse({ familyMembers: [{ name: 'Nita' }] }).success, false);
  });
});

describe('labels', () => {
  // A missing label renders a raw code like TWENTYFIVE_TO_50L to a salesperson.
  it('every band, category and code has one', () => {
    for (const band of ANNUAL_INCOME_BANDS) assert.ok(ANNUAL_INCOME_LABELS[band], band);
    for (const band of MEDICLAIM_BANDS) assert.ok(MEDICLAIM_LABELS[band], band);
    for (const risk of RISK_CATEGORIES) assert.ok(RISK_LABELS[risk], risk);
    for (const code of EXISTING_INVESTMENTS) assert.ok(EXISTING_INVESTMENT_LABELS[code], code);
    for (const rel of FAMILY_RELATIONS) assert.ok(FAMILY_RELATION_LABELS[rel], rel);
  });
});

describe('whether a profile is worth showing', () => {
  const empty = {
    occupation: null, companyName: null, designation: null, riskCategory: null,
    monthlyIncome: null, annualIncomeBand: null, monthlySip: null, monthlyEmi: null,
    investmentGoal: null, existingInvestments: [], insuranceCover: null,
    mediclaimBand: null, otherInvestments: null, familyMembers: [], updatedAt: null,
  };

  it('says no for nothing at all', () => {
    // An empty card of fourteen dashes tells a reader less than its absence.
    assert.equal(hasProfileContent(null), false);
    assert.equal(hasProfileContent(empty), false);
  });

  it('says yes for a single field', () => {
    assert.equal(hasProfileContent({ ...empty, occupation: 'Teacher' }), true);
  });

  it('says yes for family alone, with no other detail', () => {
    assert.equal(
      hasProfileContent({
        ...empty,
        familyMembers: [{ id: '1', relation: 'SON', name: null, occupation: null, location: null, maritalStatus: null }],
      }),
      true,
    );
  });
});
