import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  captureUrl,
  canTransitionEvent,
  createEventSchema,
  eventAcceptsCaptures,
  eventCodeSchema,
  generateReferralCode,
  referralCodeSchema,
  REFERRAL_CODE_LENGTH,
} from '../src/event';
import { leadCaptureSchema } from '../src/lead';

describe('event codes', () => {
  it('accepts a printable slug and lowercases it', () => {
    assert.equal(eventCodeSchema.parse('  Ahmedabad-Expo-2026 '), 'ahmedabad-expo-2026');
  });

  it('rejects anything that would break a path segment', () => {
    for (const code of ['expo 2026', 'expo/2026', 'expo?x=1', '-leading', 'ab']) {
      assert.equal(eventCodeSchema.safeParse(code).success, false, code);
    }
  });
});

describe('event validation', () => {
  const valid = { name: 'Ahmedabad Investor Expo', code: 'ahmedabad-expo', startsAt: '2026-09-01' };

  it('accepts an event with no end time', () => {
    assert.ok(createEventSchema.safeParse(valid).success);
  });

  it('rejects an end before the start', () => {
    const result = createEventSchema.safeParse({
      ...valid,
      startsAt: '2026-09-02',
      endsAt: '2026-09-01',
    });
    assert.equal(result.success, false);
    assert.equal(result.error?.issues[0]?.path[0], 'endsAt');
  });
});

describe('event lifecycle', () => {
  it('runs then completes', () => {
    assert.ok(canTransitionEvent('PLANNED', 'RUNNING'));
    assert.ok(canTransitionEvent('RUNNING', 'COMPLETED'));
  });

  it('treats completed and cancelled as final', () => {
    for (const from of ['COMPLETED', 'CANCELLED'] as const) {
      for (const to of ['PLANNED', 'RUNNING', 'COMPLETED'] as const) {
        assert.equal(canTransitionEvent(from, to), false, `${from} -> ${to}`);
      }
    }
  });

  it('only captures while running', () => {
    // The QR outlives the event by months. Someone scanning a poster nobody
    // took down must get "this has ended", not a lead nobody expects.
    assert.equal(eventAcceptsCaptures('RUNNING'), true);
    for (const status of ['PLANNED', 'COMPLETED', 'CANCELLED'] as const) {
      assert.equal(eventAcceptsCaptures(status), false, status);
    }
  });
});

describe('referral codes', () => {
  const sequential = () => {
    let index = 0;
    return (max: number) => index++ % max;
  };

  it('is the requested length', () => {
    assert.equal(generateReferralCode(sequential()).length, REFERRAL_CODE_LENGTH);
    assert.equal(generateReferralCode(sequential(), 12).length, 12);
  });

  it('omits characters that get misread aloud', () => {
    // These codes are read down a phone line and copied off printouts. A
    // partner losing a referral to a misread 0/O is a commercial dispute.
    const code = generateReferralCode(() => 0, 200) + generateReferralCode(sequential(), 200);
    for (const character of ['0', 'O', '1', 'I', 'L']) {
      assert.equal(code.includes(character), false, `contains ${character}`);
    }
  });

  it('validates and normalises a code the user typed', () => {
    assert.equal(referralCodeSchema.parse('  trn4k2pq '.toUpperCase()), 'TRN4K2PQ');
    assert.equal(referralCodeSchema.safeParse('TRN-4K2P').success, false);
    // The excluded characters are excluded on the way in, too.
    for (const ambiguous of ['TRIN4K2P', 'TRN0K2PQ', 'TRNLK2PQ']) {
      assert.equal(referralCodeSchema.safeParse(ambiguous).success, false, ambiguous);
    }
    assert.equal(referralCodeSchema.safeParse('AB').success, false);
  });

  it('draws from the whole alphabet', () => {
    const seen = new Set(generateReferralCode(sequential(), 200).split(''));
    assert.ok(seen.size > 20, `only ${seen.size} distinct characters`);
  });
});

describe('capture URLs', () => {
  it('keeps partner and event codes in separate segments', () => {
    // One shared namespace would need cross-table uniqueness no database can
    // express, and an event code shadowing a partner's would misroute business
    // with nothing in any log to explain it.
    assert.match(captureUrl('https://sihl.in', 'PARTNER', 'TRN4K2PQ'), /\/join\/p\/TRN4K2PQ$/);
    assert.match(captureUrl('https://sihl.in', 'EVENT', 'ahmedabad-expo'), /\/join\/e\/ahmedabad-expo$/);
  });

  it('escapes a code rather than trusting it into a path', () => {
    assert.equal(captureUrl('https://sihl.in', 'EVENT', 'a/b').includes('/join/e/a/b'), false);
  });
});

describe('public capture accepts codes, never ids', () => {
  const base = {
    firstName: 'Vivaan',
    mobile: '9812345678',
    consentToContact: true as const,
  };

  it('carries a partner or event code through', () => {
    const parsed = leadCaptureSchema.parse({ ...base, partnerCode: 'TRN4K2PQ' });
    assert.equal(parsed.partnerCode, 'TRN4K2PQ');
    assert.equal(leadCaptureSchema.parse({ ...base, eventCode: 'expo' }).eventCode, 'expo');
  });

  it('strips a client-supplied partnerId', () => {
    // The endpoint is unauthenticated: accepting a resolved id would let anyone
    // attribute someone else's business to themselves.
    const parsed = leadCaptureSchema.parse({ ...base, partnerId: 'partner-1234abcd' } as never);
    assert.equal('partnerId' in parsed, false);
  });

  it('still requires consent whatever the code', () => {
    assert.equal(
      leadCaptureSchema.safeParse({ ...base, consentToContact: false, partnerCode: 'TRN4K2PQ' })
        .success,
      false,
    );
  });
});
