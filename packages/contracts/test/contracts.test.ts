import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { canTransitionLead, LEAD_STATUS_TRANSITIONS, LEAD_STATUSES } from '../src/enums';
import { effectiveScope, permissionsForRoles, ROLE_PERMISSIONS, PERMISSIONS } from '../src/rbac';
import { indianMobileSchema, panSchema } from '../src/common';
import { passwordSchema } from '../src/auth';
import { leadCaptureSchema } from '../src/lead';
import { scoreLead, nextBestActions, type ScoringFeatures } from '../src/lead-scoring';
import { maskEmail, maskMobile, maskPan } from '../src/masking';

describe('lead status transitions', () => {
  it('defines a transition list for every status', () => {
    for (const status of LEAD_STATUSES) {
      assert.ok(Array.isArray(LEAD_STATUS_TRANSITIONS[status]), `missing ${status}`);
    }
  });

  it('treats CONVERTED as terminal', () => {
    assert.equal(canTransitionLead('CONVERTED', 'NEW'), false);
    assert.equal(canTransitionLead('CONVERTED', 'LOST'), false);
  });

  it('allows the happy path', () => {
    assert.ok(canTransitionLead('NEW', 'CONTACTED'));
    assert.ok(canTransitionLead('CONTACTED', 'QUALIFIED'));
    assert.ok(canTransitionLead('QUALIFIED', 'CONVERTED'));
  });

  it('rejects skipping straight from NEW to CONVERTED', () => {
    assert.equal(canTransitionLead('NEW', 'CONVERTED'), false);
  });
});

describe('rbac', () => {
  it('only references permissions that exist in the catalogue', () => {
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      for (const perm of perms) {
        assert.ok(
          (PERMISSIONS as readonly string[]).includes(perm),
          `${role} references unknown permission ${perm}`,
        );
      }
    }
  });

  it('never lets a customer read another entity type', () => {
    const perms = permissionsForRoles(['CUSTOMER']);
    assert.equal(perms.includes('lead:read'), false);
    assert.equal(perms.includes('audit:read'), false);
  });

  it('unions permissions across multiple roles', () => {
    const perms = permissionsForRoles(['SALES_EXECUTIVE', 'MARKETING']);
    assert.ok(perms.includes('visit:create'));
    assert.ok(perms.includes('campaign:create'));
  });

  it('never widens scope beyond what the role allows', () => {
    // A sales executive record asking for ALL still resolves to SELF.
    assert.equal(effectiveScope(['SALES_EXECUTIVE'], 'ALL'), 'SELF');
    // Narrowing is honoured.
    assert.equal(effectiveScope(['MANAGEMENT'], 'BRANCH'), 'BRANCH');
    // Multiple roles take the broadest role grant as the ceiling.
    assert.equal(effectiveScope(['SALES_EXECUTIVE', 'SALES_MANAGER']), 'TEAM');
  });
});

describe('field validation', () => {
  it('normalises Indian mobile numbers', () => {
    assert.equal(indianMobileSchema.parse('+91 98765 43210'), '9876543210');
    assert.equal(indianMobileSchema.parse('09876543210'), '9876543210');
    assert.equal(indianMobileSchema.safeParse('12345').success, false);
    assert.equal(indianMobileSchema.safeParse('5876543210').success, false);
  });

  it('validates PAN format', () => {
    assert.equal(panSchema.parse('abcde1234f'), 'ABCDE1234F');
    assert.equal(panSchema.safeParse('ABCD1234F').success, false);
  });

  it('enforces the password policy', () => {
    assert.equal(passwordSchema.safeParse('short1!A').success, false);
    assert.equal(passwordSchema.safeParse('alllowercase123!').success, false);
    assert.ok(passwordSchema.safeParse('CorrectHorse9!x').success);
  });

  it('requires explicit consent on public lead capture', () => {
    const result = leadCaptureSchema.safeParse({
      firstName: 'Asha',
      mobile: '9876543210',
      consentToContact: false,
    });
    assert.equal(result.success, false);
  });
});

describe('lead scoring', () => {
  const base: ScoringFeatures = {
    source: 'IMPORT',
    productInterest: [],
    hasEmail: false,
    hasPan: false,
    hasCity: false,
    activityCount: 0,
    ageInDays: 0,
    daysSinceLastActivity: null,
    estimatedValue: null,
    hasCampaignAttribution: false,
  };

  it('stays inside 0–100 for extreme inputs', () => {
    const cold = scoreLead({ ...base, ageInDays: 400 });
    assert.ok(cold.score >= 0 && cold.score <= 100);

    const hot = scoreLead({
      ...base,
      source: 'REFERRAL',
      productInterest: ['PMS', 'AIF', 'DERIVATIVES', 'ALGO', 'NRI'],
      hasEmail: true,
      hasPan: true,
      hasCity: true,
      activityCount: 50,
      estimatedValue: 50_000_000,
      hasCampaignAttribution: true,
      daysSinceLastActivity: 0,
    });
    assert.ok(hot.score >= 0 && hot.score <= 100);
    assert.equal(hot.score, 100);
  });

  it('scores a referral above a cold import', () => {
    const referral = scoreLead({ ...base, source: 'REFERRAL' });
    const imported = scoreLead({ ...base, source: 'IMPORT' });
    assert.ok(referral.score > imported.score);
  });

  it('decays a lead that has gone quiet', () => {
    const fresh = scoreLead({ ...base, source: 'WEBSITE', activityCount: 2, daysSinceLastActivity: 1 });
    const stale = scoreLead({ ...base, source: 'WEBSITE', activityCount: 2, daysSinceLastActivity: 40 });
    assert.ok(fresh.score > stale.score);
  });

  it('explains every point it awards', () => {
    const result = scoreLead({ ...base, source: 'PARTNER', hasEmail: true });
    const sum = result.factors.reduce((total, factor) => total + factor.points, 0);
    assert.equal(result.score, Math.max(0, Math.min(100, sum)));
    assert.ok(result.factors.length > 0);
  });

  it('puts assignment first when a lead has no owner', () => {
    const actions = nextBestActions(base, {
      status: 'NEW',
      hasOwner: false,
      followUpOverdue: false,
    });
    assert.equal(actions[0]?.code, 'ASSIGN_OWNER');
  });
});

describe('pii masking', () => {
  it('keeps only the last four digits of a mobile', () => {
    assert.equal(maskMobile('9876543210'), '••••••3210');
  });

  it('masks the local part of an email but keeps the domain', () => {
    assert.equal(maskEmail('asha.patel@example.com'), 'as••••••••@example.com');
  });

  it('masks the middle of a PAN', () => {
    assert.equal(maskPan('ABCDE1234F'), 'ABC••••F');
  });

  it('returns an empty string rather than throwing on null', () => {
    assert.equal(maskMobile(null), '');
    assert.equal(maskPan(undefined), '');
  });
});
