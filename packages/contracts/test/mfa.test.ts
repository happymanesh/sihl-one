import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  disableMfaSchema,
  enableMfaSchema,
  generateRecoveryCodes,
  isMfaChallenge,
  MFA_RECOVERY_CODE_COUNT,
  normaliseRecoveryCode,
  totpCodeSchema,
} from '../src/mfa';

/** Deterministic but well-spread, so distinctness is a real test not a fluke. */
const pseudoRandom = () => {
  let seed = 20260811;
  return (max: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % max;
  };
};

describe('recovery codes', () => {
  it('generates the expected number, all distinct', () => {
    const codes = generateRecoveryCodes(pseudoRandom());
    assert.equal(codes.length, MFA_RECOVERY_CODE_COUNT);
    assert.equal(new Set(codes).size, MFA_RECOVERY_CODE_COUNT);
  });

  it('omits characters that get misread on paper', () => {
    // Written down and read back under stress, when a phone has just been lost.
    const joined = generateRecoveryCodes(pseudoRandom(), 40).join('');
    for (const character of ['0', 'O', '1', 'I', 'L']) {
      assert.equal(joined.includes(character), false, `contains ${character}`);
    }
  });

  it('fails loudly rather than hanging on a degenerate source', () => {
    // A source with no variety cannot produce distinct codes. An unbounded
    // retry would spin forever inside enrolment.
    assert.throws(() => generateRecoveryCodes(() => 0, 5), /not varied enough/);
  });

  it('is grouped for legibility', () => {
    assert.match(generateRecoveryCodes(pseudoRandom(), 1)[0]!, /^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
  });

  it('accepts a code however the user retypes it', () => {
    const target = normaliseRecoveryCode('ABCDE-FGHJK');
    for (const typed of ['abcde-fghjk', 'ABCDE FGHJK', '  abcdefghjk  ', 'AbCdE-fGhJk']) {
      assert.equal(normaliseRecoveryCode(typed), target, typed);
    }
  });
});

describe('TOTP code input', () => {
  it('accepts six digits, with or without a space', () => {
    assert.equal(totpCodeSchema.parse('123456'), '123456');
    assert.equal(totpCodeSchema.parse('123 456'), '123456');
  });

  it('rejects anything that is not six digits', () => {
    for (const bad of ['12345', '1234567', 'abcdef', '']) {
      assert.equal(totpCodeSchema.safeParse(bad).success, false, bad);
    }
  });
});

describe('disabling', () => {
  it('demands both the password and a current code', () => {
    // A hijacked session could otherwise switch MFA off and lock the owner out.
    assert.equal(disableMfaSchema.safeParse({ code: '123456' }).success, false);
    assert.equal(disableMfaSchema.safeParse({ password: 'x' }).success, false);
    assert.ok(disableMfaSchema.safeParse({ password: 'x', code: '123456' }).success);
  });
});

describe('enabling', () => {
  it('requires the secret back, so nothing half-enrolled persists', () => {
    assert.equal(enableMfaSchema.safeParse({ code: '123456' }).success, false);
    assert.ok(
      enableMfaSchema.safeParse({ secret: 'JBSWY3DPEHPK3PXP', code: '123456' }).success,
    );
  });
});

describe('login result', () => {
  it('recognises a challenge and does not mistake a normal login for one', () => {
    assert.equal(isMfaChallenge({ mfaRequired: true, challengeToken: 't', expiresInSeconds: 300 }), true);
    assert.equal(isMfaChallenge({ user: {}, tokens: {} }), false);
    assert.equal(isMfaChallenge(null), false);
  });
});
