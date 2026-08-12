import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canSend,
  createTemplateSchema,
  extractVariables,
  isQuietHour,
  renderTemplate,
  smsSegments,
  type RecipientState,
} from '../src/messaging';

const recipient = (over: Partial<RecipientState> = {}): RecipientState => ({
  channel: 'SMS',
  destination: '9000000001',
  isDndRegistered: false,
  hasMarketingConsent: false,
  hasOptedOut: false,
  isCustomer: true,
  ...over,
});

const MIDDAY = 14;
const NIGHT = 22;

describe('templates', () => {
  it('finds each variable once', () => {
    assert.deepEqual(extractVariables('Hi {{name}}, your {{product}} — {{name}}'), [
      'name',
      'product',
    ]);
  });

  it('substitutes values', () => {
    const result = renderTemplate('Hi {{name}}, ref {{ref}}.', { name: 'Priya', ref: 'LD-1' });
    assert.equal(result.text, 'Hi Priya, ref LD-1.');
    assert.equal(result.missing.length, 0);
  });

  it('reports a missing value instead of blanking it', () => {
    // "Dear ," reaching a client is worse than the send failing.
    const result = renderTemplate('Dear {{name}}, welcome.', {});
    assert.deepEqual(result.missing, ['name']);
    assert.match(result.text, /\{\{name\}\}/);
  });

  it('treats empty string and null as missing', () => {
    assert.deepEqual(renderTemplate('{{a}}{{b}}', { a: '', b: null }).missing, ['a', 'b']);
  });

  it('substitutes a value that looks like a placeholder without re-expanding it', () => {
    // A customer legitimately named "{{admin}}" must not become an injection.
    const result = renderTemplate('Hi {{name}}.', { name: '{{secret}}' });
    assert.equal(result.text, 'Hi {{secret}}.');
    assert.equal(result.missing.length, 0);
  });

  it('counts SMS segments', () => {
    assert.equal(smsSegments(''), 0);
    assert.equal(smsSegments('a'.repeat(160)), 1);
    assert.equal(smsSegments('a'.repeat(161)), 2);
  });

  it('requires a subject on an email template', () => {
    const base = { code: 'WELCOME', name: 'Welcome', purpose: 'SERVICE' as const, body: 'Hello there' };
    assert.equal(createTemplateSchema.safeParse({ ...base, channel: 'EMAIL' }).success, false);
    assert.ok(createTemplateSchema.safeParse({ ...base, channel: 'EMAIL', subject: 'Hi' }).success);
    assert.ok(createTemplateSchema.safeParse({ ...base, channel: 'SMS' }).success);
  });
});

describe('quiet hours', () => {
  it('runs 21:00 to 08:59', () => {
    for (const hour of [21, 22, 23, 0, 5, 8]) assert.equal(isQuietHour(hour), true, String(hour));
    for (const hour of [9, 12, 20]) assert.equal(isQuietHour(hour), false, String(hour));
  });
});

describe('the gate refuses by default', () => {
  it('will not send without a destination', () => {
    const decision = canSend('TRANSACTIONAL', recipient({ destination: null }), MIDDAY);
    assert.equal(decision.allowed, false);
    assert.equal(decision.code, 'NO_DESTINATION');
  });

  it('always states a reason when it refuses', () => {
    const refusals = [
      canSend('TRANSACTIONAL', recipient({ destination: null }), MIDDAY),
      canSend('PROMOTIONAL', recipient(), MIDDAY),
      canSend('SERVICE', recipient({ isCustomer: false }), MIDDAY),
    ];
    for (const decision of refusals) {
      assert.equal(decision.allowed, false);
      assert.ok((decision.reason ?? '').length > 15, JSON.stringify(decision));
    }
  });
});

describe('transactional is exempt, but not from an opt-out', () => {
  it('sends at night, to a DND number, without marketing consent', () => {
    // A margin call at 22:00 is the one message that must go out.
    const decision = canSend(
      'TRANSACTIONAL',
      recipient({ isDndRegistered: true, hasMarketingConsent: false }),
      NIGHT,
    );
    assert.equal(decision.allowed, true);
  });

  it('still refuses if they have opted out of the channel', () => {
    // "But this one is important" is exactly the reasoning that gets a broker
    // fined.
    const decision = canSend('TRANSACTIONAL', recipient({ hasOptedOut: true }), MIDDAY);
    assert.equal(decision.allowed, false);
    assert.equal(decision.code, 'OPTED_OUT');
  });
});

describe('service messages', () => {
  it('go to clients, not leads', () => {
    assert.equal(canSend('SERVICE', recipient({ isCustomer: false }), MIDDAY).code, 'NOT_A_CUSTOMER');
    assert.equal(canSend('SERVICE', recipient(), MIDDAY).allowed, true);
  });

  it('respect quiet hours but ignore DND', () => {
    assert.equal(canSend('SERVICE', recipient(), NIGHT).code, 'QUIET_HOURS');
    assert.equal(canSend('SERVICE', recipient({ isDndRegistered: true }), MIDDAY).allowed, true);
  });
});

describe('promotional messages', () => {
  const consented = () => recipient({ hasMarketingConsent: true });

  it('need marketing consent', () => {
    const decision = canSend('PROMOTIONAL', recipient({ hasMarketingConsent: false }), MIDDAY);
    assert.equal(decision.code, 'NO_CONSENT');
    // Consent to be serviced is not consent to be sold to.
    assert.match(decision.reason ?? '', /not consent to be sold to/i);
  });

  it('never go to a DND-registered number', () => {
    assert.equal(
      canSend('PROMOTIONAL', recipient({ hasMarketingConsent: true, isDndRegistered: true }), MIDDAY)
        .code,
      'DND_REGISTERED',
    );
  });

  it('never go out at night', () => {
    assert.equal(canSend('PROMOTIONAL', consented(), NIGHT).code, 'QUIET_HOURS');
  });

  it('go out when every condition is met', () => {
    assert.equal(canSend('PROMOTIONAL', consented(), MIDDAY).allowed, true);
  });

  it('are the most restricted of the three purposes', () => {
    // The same recipient at the same hour: relabelling a promotion as
    // transactional is the abuse the regime exists to stop, so the difference
    // between the two must be real.
    const dndAtNight = recipient({ isDndRegistered: true, hasMarketingConsent: true });
    assert.equal(canSend('TRANSACTIONAL', dndAtNight, NIGHT).allowed, true);
    assert.equal(canSend('PROMOTIONAL', dndAtNight, NIGHT).allowed, false);
  });
});
