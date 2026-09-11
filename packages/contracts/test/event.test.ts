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

  it('captures whenever the event has been opened by hand', () => {
    assert.equal(eventAcceptsCaptures('RUNNING'), true);
  });

  it('refuses once the event is closed, however it was closed', () => {
    // The QR outlives the event by months. Someone scanning a poster nobody
    // took down must get "this has ended", not a lead nobody expects.
    for (const status of ['COMPLETED', 'CANCELLED'] as const) {
      assert.equal(eventAcceptsCaptures(status), false, status);
    }
  });

  it('refuses a planned event when nothing is known but the status', () => {
    assert.equal(eventAcceptsCaptures('PLANNED'), false);
  });

  describe('a planned event that is actually happening', () => {
    // The two-day meet on 26-27 September. The status is flipped by hand and
    // nothing flips it back, so the dates have to carry the feature on the day.
    const schedule = {
      startsAt: new Date('2026-09-26T04:00:00Z'),
      endsAt: new Date('2026-09-27T12:00:00Z'),
    };

    it('captures on the first morning even if nobody opened it', () => {
      assert.equal(
        eventAcceptsCaptures('PLANNED', schedule, new Date('2026-09-26T05:30:00Z')),
        true,
      );
    });

    it('still captures on the second day', () => {
      assert.equal(
        eventAcceptsCaptures('PLANNED', schedule, new Date('2026-09-27T06:00:00Z')),
        true,
      );
    });

    it('refuses before it starts', () => {
      assert.equal(
        eventAcceptsCaptures('PLANNED', schedule, new Date('2026-09-25T23:00:00Z')),
        false,
      );
    });

    it('refuses after it ends, so a leftover banner stops collecting', () => {
      assert.equal(
        eventAcceptsCaptures('PLANNED', schedule, new Date('2026-09-28T06:00:00Z')),
        false,
      );
    });

    it('closes 24 hours after the start when no end was given', () => {
      const open = { startsAt: new Date('2026-09-26T04:00:00Z'), endsAt: null };
      assert.equal(eventAcceptsCaptures('PLANNED', open, new Date('2026-09-26T20:00:00Z')), true);
      assert.equal(eventAcceptsCaptures('PLANNED', open, new Date('2026-09-27T05:00:00Z')), false);
    });

    it('still refuses a cancelled event inside its own window', () => {
      // Somebody cancelled it knowing something the calendar does not.
      assert.equal(
        eventAcceptsCaptures('CANCELLED', schedule, new Date('2026-09-26T05:30:00Z')),
        false,
      );
    });
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
