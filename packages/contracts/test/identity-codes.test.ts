import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createUserSchema,
  formatStaffCode,
  suggestWorkEmail,
  WORK_EMAIL_DOMAIN,
} from '../src/hierarchy';

describe('work email generation', () => {
  it('builds firstname.lastname at the company domain', () => {
    assert.equal(suggestWorkEmail('Rahul', 'Mehta'), `rahul.mehta@${WORK_EMAIL_DOMAIN}`);
  });

  it('lowercases and ignores stray spacing', () => {
    assert.equal(suggestWorkEmail('  RAHUL ', ' Mehta '), 'rahul.mehta@sihl.in');
  });

  it('strips accents rather than emitting them into an address', () => {
    assert.equal(suggestWorkEmail('Zoë', 'Fernandes'), 'zoe.fernandes@sihl.in');
  });

  it('closes up a multi-word surname instead of adding another dot', () => {
    // Predictable shape matters more than fidelity: the address gets read down
    // a phone line and typed by someone else.
    assert.equal(suggestWorkEmail('Anita', 'Rani Sharma'), 'anita.ranisharma@sihl.in');
  });

  it('drops punctuation from names', () => {
    assert.equal(suggestWorkEmail("D'Souza", 'Pinto'), 'dsouza.pinto@sihl.in');
  });

  it('gives the second Rahul Mehta a numeral, and the first none', () => {
    assert.equal(
      suggestWorkEmail('Rahul', 'Mehta', ['rahul.mehta@sihl.in']),
      'rahul.mehta2@sihl.in',
    );
    assert.equal(
      suggestWorkEmail('Rahul', 'Mehta', ['rahul.mehta@sihl.in', 'rahul.mehta2@sihl.in']),
      'rahul.mehta3@sihl.in',
    );
  });

  it('matches a taken address regardless of how it was cased', () => {
    assert.equal(
      suggestWorkEmail('Rahul', 'Mehta', ['Rahul.Mehta@SIHL.in']),
      'rahul.mehta2@sihl.in',
    );
  });

  it('returns null when a name yields no letters, rather than an empty address', () => {
    assert.equal(suggestWorkEmail('...', '???'), null);
  });
});

describe('staff codes', () => {
  it('pads to four digits behind the SIHL prefix', () => {
    assert.equal(formatStaffCode(1), 'SIHL-0001');
    assert.equal(formatStaffCode(42), 'SIHL-0042');
    assert.equal(formatStaffCode(1234), 'SIHL-1234');
  });

  it('keeps going past four digits rather than truncating', () => {
    assert.equal(formatStaffCode(12345), 'SIHL-12345');
  });
});

describe('creating a user', () => {
  const base = {
    firstName: 'Rahul',
    lastName: 'Mehta',
    designationId: 'cmsl2qi8t004qksts2ucwcecd',
    roleCodes: ['SALES_EXECUTIVE'],
    orgUnitId: 'cmsl2qi8t004qksts2ucwcecc',
  };

  it('accepts a staff member with no email and no code — both are generated', () => {
    const parsed = createUserSchema.safeParse({ ...base, userType: 'INTERNAL' });
    assert.equal(parsed.success, true);
  });

  it('requires a partner to bring their back-office code', () => {
    const parsed = createUserSchema.safeParse({
      ...base,
      userType: 'PARTNER',
      email: 'ops@trinetrafin.in',
    });
    assert.equal(parsed.success, false);
    assert.match(JSON.stringify(parsed.error?.issues), /back office/i);
  });

  it('requires a partner to bring their own email', () => {
    // Partners are not SIHL staff and do not get SIHL mail.
    const parsed = createUserSchema.safeParse({
      ...base,
      userType: 'PARTNER',
      employeeCode: 'R0018',
    });
    assert.equal(parsed.success, false);
    assert.match(JSON.stringify(parsed.error?.issues), /own email/i);
  });

  it('accepts a fully specified partner', () => {
    const parsed = createUserSchema.safeParse({
      ...base,
      userType: 'PARTNER',
      employeeCode: 'R0018',
      email: 'ops@trinetrafin.in',
    });
    assert.equal(parsed.success, true);
    assert.equal(parsed.success && parsed.data.employeeCode, 'R0018');
  });

  it('uppercases a code typed in lower case', () => {
    const parsed = createUserSchema.safeParse({
      ...base,
      userType: 'PARTNER',
      employeeCode: 'r0018',
      email: 'ops@trinetrafin.in',
    });
    assert.equal(parsed.success && parsed.data.employeeCode, 'R0018');
  });
});
