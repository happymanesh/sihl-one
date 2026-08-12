import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  campaignCodeSchema,
  campaignTrackingUrl,
  canTransitionCampaign,
  computeCampaignPerformance,
  createCampaignSchema,
  MIN_LEADS_FOR_VERDICT,
  updateCampaignSchema,
} from '../src/campaign';

const valid = {
  name: 'Diwali account opening',
  code: 'diwali-2026',
  channels: ['EMAIL', 'WHATSAPP'] as const,
};

describe('campaign codes', () => {
  it('accepts URL-safe codes and lowercases them', () => {
    assert.equal(campaignCodeSchema.parse('  Diwali-2026 '), 'diwali-2026');
    assert.ok(campaignCodeSchema.safeParse('q3_search.brand').success);
  });

  it('rejects anything that would break a link', () => {
    // These end up in utm_campaign; a space works until someone copies the URL
    // out of an email client.
    for (const code of ['diwali 2026', 'diwali/2026', 'diwali?x=1', '-leading', '']) {
      assert.equal(campaignCodeSchema.safeParse(code).success, false, code);
    }
  });
});

describe('campaign validation', () => {
  it('requires at least one channel', () => {
    assert.equal(createCampaignSchema.safeParse({ ...valid, channels: [] }).success, false);
  });

  it('rejects an end date before the start date', () => {
    const result = createCampaignSchema.safeParse({
      ...valid,
      startsAt: '2026-11-01',
      endsAt: '2026-10-01',
    });
    assert.equal(result.success, false);
    assert.equal(result.error?.issues[0]?.path[0], 'endsAt');
  });

  it('accepts a campaign with no dates at all', () => {
    assert.ok(createCampaignSchema.safeParse(valid).success);
  });

  it('does not let the code be changed', () => {
    // The code is live in published links and on every attributed lead.
    const parsed = updateCampaignSchema.parse({ name: 'Renamed', code: 'something-else' } as never);
    assert.equal('code' in parsed, false);
  });
});

describe('status transitions', () => {
  it('allows the normal run', () => {
    assert.ok(canTransitionCampaign('DRAFT', 'SCHEDULED'));
    assert.ok(canTransitionCampaign('SCHEDULED', 'RUNNING'));
    assert.ok(canTransitionCampaign('RUNNING', 'PAUSED'));
    assert.ok(canTransitionCampaign('PAUSED', 'RUNNING'));
    assert.ok(canTransitionCampaign('RUNNING', 'COMPLETED'));
  });

  it('refuses to reopen a completed campaign', () => {
    // Spend and attributed leads have already been reported against it.
    assert.equal(canTransitionCampaign('COMPLETED', 'RUNNING'), false);
    assert.equal(canTransitionCampaign('COMPLETED', 'DRAFT'), false);
  });

  it('treats archived as terminal', () => {
    for (const to of ['DRAFT', 'RUNNING', 'COMPLETED'] as const) {
      assert.equal(canTransitionCampaign('ARCHIVED', to), false, to);
    }
  });
});

describe('performance', () => {
  const base = { leads: 100, qualified: 40, converted: 20, convertedValue: 4_000_000 };

  it('computes rates and costs', () => {
    const result = computeCampaignPerformance({ ...base, spend: 200_000, budget: 250_000 });

    assert.equal(result.conversionRate, 20);
    assert.equal(result.qualificationRate, 40);
    assert.equal(result.costPerLead, 2000);
    assert.equal(result.costPerAcquisition, 10_000);
    assert.equal(result.attributedValuePerRupee, 20);
    assert.equal(result.budgetUsedPercent, 80);
  });

  it('returns null rather than zero when spend is unknown', () => {
    // Zero is a claim — "this was free" — and it gets campaigns renewed.
    const result = computeCampaignPerformance({ ...base, spend: null, budget: null });
    assert.equal(result.costPerLead, null);
    assert.equal(result.costPerAcquisition, null);
    assert.equal(result.attributedValuePerRupee, null);
    assert.match(result.verdict, /record the spend/i);
  });

  it('never divides by zero', () => {
    const empty = computeCampaignPerformance({
      leads: 0,
      qualified: 0,
      converted: 0,
      convertedValue: 0,
      spend: 0,
      budget: 0,
    });
    for (const value of [empty.costPerLead, empty.costPerAcquisition, empty.attributedValuePerRupee]) {
      assert.equal(value, null);
    }
    assert.equal(empty.conversionRate, 0);
    assert.match(empty.verdict, /no leads/i);
  });

  it('does not report cost per acquisition with no acquisitions', () => {
    const result = computeCampaignPerformance({ ...base, converted: 0, spend: 100_000, budget: null });
    assert.equal(result.costPerAcquisition, null);
    assert.equal(result.costPerLead, 1000);
  });

  it('never claims a campaign is worth continuing', () => {
    // "Worth continuing" needs a cost-per-acquisition benchmark SIHL has not
    // set. The verdict states the numbers; the marketing head decides.
    for (const convertedValue of [50_000, 400_000_000]) {
      const result = computeCampaignPerformance({ ...base, convertedValue, spend: 200_000, budget: null });
      assert.equal(/worth continuing|recommend|should/i.test(result.verdict), false, result.verdict);
      assert.match(result.verdict, /per account/i);
    }
  });

  it('does not present business value as a return', () => {
    // estimatedValue is the size of the client won, not brokerage earned. A
    // 75x "ROI" is how a budget gets renewed on a number nobody checked.
    const result = computeCampaignPerformance({
      ...base,
      convertedValue: 15_000_000,
      spend: 200_000,
      budget: null,
    });
    assert.equal(result.attributedValuePerRupee, 75);
    assert.equal(/return/i.test(result.verdict), false);
    assert.match(result.caveat ?? '', /not brokerage earned/i);
  });

  it('says so when nothing has converted', () => {
    const result = computeCampaignPerformance({
      leads: 40,
      qualified: 10,
      converted: 0,
      convertedValue: 0,
      spend: 200_000,
      budget: null,
    });
    assert.equal(result.costPerAcquisition, null);
    assert.match(result.verdict, /nothing converted/i);
  });

  it('warns when the sample is too small to argue from', () => {
    const result = computeCampaignPerformance({
      leads: MIN_LEADS_FOR_VERDICT - 5,
      qualified: 3,
      converted: 2,
      convertedValue: 500_000,
      spend: 10_000,
      budget: null,
    });
    assert.match(result.caveat ?? '', /indicative/i);
  });

  it('always says what attributed value actually is, at scale', () => {
    const result = computeCampaignPerformance({ ...base, spend: 200_000, budget: null });
    assert.match(result.caveat ?? '', /not brokerage earned/i);
  });
});

describe('tracking URL', () => {
  it('attaches the campaign code as utm_campaign', () => {
    const url = new URL(campaignTrackingUrl('https://sihl.in/open-account', 'diwali-2026', 'EMAIL'));
    assert.equal(url.searchParams.get('utm_campaign'), 'diwali-2026');
    assert.equal(url.searchParams.get('utm_source'), 'email');
    assert.equal(url.searchParams.get('utm_medium'), 'email');
  });

  it('maps paid search to cpc rather than to its own name', () => {
    const url = new URL(campaignTrackingUrl('https://sihl.in/', 'brand', 'SEARCH'));
    assert.equal(url.searchParams.get('utm_medium'), 'cpc');
  });

  it('preserves an existing path and query', () => {
    const url = new URL(
      campaignTrackingUrl('https://sihl.in/open-account?ref=abc', 'diwali-2026'),
    );
    assert.equal(url.pathname, '/open-account');
    assert.equal(url.searchParams.get('ref'), 'abc');
  });
});
