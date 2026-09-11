import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  istTimestamp,
  passwordResetEmail,
} from '../../src/modules/mail/password-reset.template';
import { maskEmail } from '../../src/modules/mail/mailer';

const base = {
  firstName: 'Manesh',
  employeeCode: 'SIHL-1001',
  email: 'manesh.mukherjee@sihl.in',
  temporaryPassword: 'Kf7q-Rm2x-Tw9d',
  appUrl: 'https://lms.sihl.in',
  when: new Date('2026-09-08T10:54:00Z'), // 16:24 IST
  productName: 'SIHL LMS+',
};

describe('password reset email', () => {
  it('uses the agreed subject line', () => {
    assert.equal(passwordResetEmail(base).subject, 'Your SIHL LMS+ password has been reset');
  });

  it('names the employee code as the username, which is what staff sign in with', () => {
    const { text, html } = passwordResetEmail(base);
    assert.ok(text.includes('Username: SIHL-1001'));
    assert.ok(html.includes('SIHL-1001'));
  });

  it('falls back to the email address when there is no employee code', () => {
    // Partners and older accounts have no code. "Use your username" without
    // saying what it is helps nobody.
    const { text } = passwordResetEmail({ ...base, employeeCode: null });
    assert.ok(text.includes('Username: manesh.mukherjee@sihl.in'));
  });

  it('carries the temporary password in both bodies', () => {
    const { text, html } = passwordResetEmail(base);
    assert.ok(text.includes('Kf7q-Rm2x-Tw9d'));
    assert.ok(html.includes('Kf7q-Rm2x-Tw9d'));
  });

  it('shows the time in IST, not the server’s UTC', () => {
    // 10:54 UTC is 16:24 in Kolkata. Getting this wrong would tell somebody
    // their password was reset five and a half hours before it was.
    const { text } = passwordResetEmail(base);
    assert.ok(text.includes('08-Sep-2026 16:24 IST'), text.slice(0, 200));
  });

  it('names the product everywhere, and never the internal name', () => {
    const { subject, text, html } = passwordResetEmail(base);
    for (const body of [subject, text, html]) {
      assert.ok(body.includes('SIHL LMS+'));
      assert.ok(!/SIHL ONE/i.test(body), 'the internal product name must not reach a recipient');
    }
  });

  it('tells the recipient what to do if it was not them', () => {
    const { text } = passwordResetEmail(base);
    assert.match(text, /If this was NOT you/);
    assert.match(text, /contact your support desk/);
  });

  it('links to the configured address', () => {
    const { text, html } = passwordResetEmail(base);
    assert.ok(text.includes('https://lms.sihl.in'));
    assert.ok(html.includes('href="https://lms.sihl.in"'));
  });

  it('escapes a name that would otherwise inject markup', () => {
    // Names come from user input, and this body is HTML.
    const { html } = passwordResetEmail({ ...base, firstName: '<script>alert(1)</script>' });
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));
  });

  it('escapes a temporary password containing HTML-significant characters', () => {
    const { html } = passwordResetEmail({ ...base, temporaryPassword: 'a<b>&"c' });
    assert.ok(html.includes('a&lt;b&gt;&amp;&quot;c'));
  });
});

describe('istTimestamp', () => {
  it('renders a three-letter month, not en-GB’s "Sept"', () => {
    assert.match(istTimestamp(new Date('2026-09-08T10:54:00Z')), /^08-Sep-2026 16:24$/);
  });

  it('rolls the date over at IST midnight', () => {
    assert.match(istTimestamp(new Date('2026-09-08T18:31:00Z')), /^09-Sep-2026 00:01$/);
  });
});

describe('maskEmail', () => {
  it('identifies a recipient in logs without printing the address', () => {
    assert.equal(maskEmail('manesh.mukherjee@sihl.in'), 'ma***@sihl.in');
  });
});
