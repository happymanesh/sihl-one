import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MOBILE_VERIFICATION_METHOD_LABELS,
  MOBILE_VERIFICATION_METHODS,
  verificationSurvivesEdit,
  verifyLeadMobileSchema,
} from '../src/lead';

describe('mobile verification input', () => {
  it('accepts a method with no note', () => {
    assert.equal(verifyLeadMobileSchema.safeParse({ method: 'CALL' }).success, true);
  });

  it('refuses a method nobody defined', () => {
    assert.equal(verifyLeadMobileSchema.safeParse({ method: 'TRUST_ME' }).success, false);
  });

  it('refuses a missing method — a bare tick says nothing', () => {
    assert.equal(verifyLeadMobileSchema.safeParse({ note: 'verified' }).success, false);
  });

  it('gives every method a label, so the UI cannot show a raw code', () => {
    for (const method of MOBILE_VERIFICATION_METHODS) {
      assert.ok(MOBILE_VERIFICATION_METHOD_LABELS[method], `${method} has no label`);
    }
  });
});

describe('verification survives an edit', () => {
  // The rule the feature rests on. Without it a rep verifies the number they
  // genuinely called, edits the lead to a different one, and keeps the tick.

  it('is discarded when the number changes', () => {
    assert.equal(verificationSurvivesEdit('9820000001', '9820000002'), false);
  });

  it('survives when the edit does not touch the number', () => {
    assert.equal(verificationSurvivesEdit('9820000001', undefined), true);
  });

  it('survives a reformat of the same number', () => {
    // Reps type all of these. Throwing away a genuine verification because
    // someone added a space would train them to stop verifying at all.
    assert.equal(verificationSurvivesEdit('9820000001', '98200 00001'), true);
    assert.equal(verificationSurvivesEdit('9820000001', '+91 98200 00001'), true);
    assert.equal(verificationSurvivesEdit('9820000001', '09820000001'), true);
    assert.equal(verificationSurvivesEdit('9820000001', '+91-98200-00001'), true);
  });

  it('is discarded when only the last digit changes', () => {
    // The realistic fake: verify a number you control, then nudge one digit.
    assert.equal(verificationSurvivesEdit('9820000001', '9820000009'), false);
  });

  it('is discarded when the number is cleared', () => {
    assert.equal(verificationSurvivesEdit('9820000001', ''), false);
  });

  it('does not treat two different numbers as equal on a shared suffix', () => {
    assert.equal(verificationSurvivesEdit('9820000001', '8820000001'), false);
  });
});
