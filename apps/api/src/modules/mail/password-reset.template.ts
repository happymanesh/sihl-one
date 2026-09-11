/**
 * The password-reset email.
 *
 * A pure function: give it the facts, get back a subject and two bodies. No
 * config lookup, no clock, no I/O — which is what makes the wording testable
 * and keeps the one place a temporary password appears in prose free of any
 * reason to reach for a database.
 *
 * The copy was agreed line by line with the product owner. Treat changes to it
 * as a product decision rather than a tidy-up.
 */

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * `08-Sep-2026 16:24`, in IST.
 *
 * Four-digit year here, unlike the duplicate-lead message: this is prose a
 * person reads once, not a fixed-width field, and an unambiguous year in a
 * security email is worth the two characters. The month is still mapped from
 * its number rather than the locale, because `en-GB` renders September as
 * "Sept" and the width would drift.
 */
export function istTimestamp(when: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(when);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const month = SHORT_MONTHS[Number(part('month')) - 1] ?? part('month');
  return `${part('day')}-${month}-${part('year')} ${part('hour')}:${part('minute')}`;
}

/** Anything interpolated into the HTML body is escaped; names come from user input. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface PasswordResetEmailInput {
  firstName: string;
  /**
   * The employee code, which is what staff actually sign in with. Optional
   * because a user can exist without one — a partner, or an account created
   * before codes were issued — and in that case the email falls back to naming
   * their email address, since telling somebody to "use your username" without
   * saying what it is helps nobody.
   */
  employeeCode: string | null;
  email: string;
  temporaryPassword: string;
  appUrl: string;
  when: Date;
  productName: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function passwordResetEmail(input: PasswordResetEmailInput): RenderedEmail {
  const { firstName, temporaryPassword, appUrl, productName } = input;
  const stamp = istTimestamp(input.when);
  const username = input.employeeCode ?? input.email;

  const subject = `Your ${productName} password has been reset`;

  const text = `Hello ${firstName},

An administrator has reset your password for ${productName}.

When: ${stamp} IST
Username: ${username}
Temporary password: ${temporaryPassword}

What happens next
Sign in with the username and temporary password above. You will be asked to set a new
password straight away, before you can use the system.

  ${appUrl}

For your security, you have been signed out on every device. Any session opened
before this reset no longer works.

If this was NOT you
Login with this temporary password and change it. If there is any issue in
login, contact your support desk as your account may have been taken over, and
because the password has already been changed you will not be able to recover
it yourself — an administrator has to reset it for you.

This is an automated message from ${productName}. Please do not reply.

Shah Investors Home Ltd`;

  const name = escapeHtml(firstName);
  const product = escapeHtml(productName);
  const password = escapeHtml(temporaryPassword);
  const url = escapeHtml(appUrl);

  // Table-based layout with inline styles: Outlook ignores <style> blocks and
  // most of flexbox, and this has to survive a desktop mail client as well as a
  // phone.
  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f4f5f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;border:1px solid #e3e6ea;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2933;">
        <tr><td style="padding:22px 28px 0;">
          <p style="margin:0;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0f2e5c;">${product}</p>
        </td></tr>
        <tr><td style="padding:14px 28px 0;">
          <h1 style="margin:0;font-size:20px;line-height:1.3;font-weight:700;">Your password has been reset</h1>
        </td></tr>
        <tr><td style="padding:14px 28px 0;font-size:15px;line-height:1.6;">
          <p style="margin:0 0 14px;">Hello ${name},</p>
          <p style="margin:0 0 14px;">An administrator has reset your password for ${product}.</p>
          <p style="margin:0 0 6px;font-size:13px;color:#52606d;">When</p>
          <p style="margin:0 0 16px;font-weight:600;">${stamp} IST</p>
        </td></tr>
        <tr><td style="padding:0 28px 14px;">
          <p style="margin:0 0 6px;font-size:13px;color:#52606d;">Username</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f9fc;border:1px solid #cfd8e3;border-radius:6px;">
            <tr><td align="center" style="padding:12px 16px;font-family:Consolas,Menlo,Monaco,'Courier New',monospace;font-size:17px;font-weight:700;letter-spacing:.05em;color:#0f2e5c;">${escapeHtml(username)}</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 28px;">
          <p style="margin:0 0 6px;font-size:13px;color:#52606d;">Temporary password</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f9fc;border:1px solid #cfd8e3;border-radius:6px;">
            <tr><td align="center" style="padding:14px 16px;font-family:Consolas,Menlo,Monaco,'Courier New',monospace;font-size:19px;font-weight:700;letter-spacing:.06em;color:#0f2e5c;">${password}</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:18px 28px 0;font-size:14px;line-height:1.6;">
          <strong>What happens next</strong>
          <p style="margin:6px 0 0;color:#52606d;">Sign in with the username and temporary password above. You will be asked to set a new password straight away, before you can use the system.</p>
        </td></tr>
        <tr><td style="padding:16px 28px 0;" align="center">
          <a href="${url}" style="display:inline-block;background:#0f2e5c;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:11px 26px;border-radius:6px;">Sign in to ${product}</a>
        </td></tr>
        <tr><td style="padding:18px 28px 0;font-size:14px;line-height:1.6;color:#52606d;">
          <p style="margin:0;">For your security you have been signed out on every device. Any session opened before this reset no longer works.</p>
        </td></tr>
        <tr><td style="padding:18px 28px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff8f0;border:1px solid #f0d5b8;border-radius:6px;">
            <tr><td style="padding:14px 16px;font-size:14px;line-height:1.6;">
              <strong style="display:block;margin-bottom:6px;">If this was not you</strong>
              Login with this temporary password and change it. If there is any issue in login,
              contact your support desk as your account may have been taken over, and because the
              password has already been changed you will not be able to recover it yourself
              &mdash; an administrator has to reset it for you.
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:22px 28px 26px;border-top:1px solid #eef1f4;">
          <p style="margin:14px 0 0;font-size:12px;line-height:1.5;color:#7b8794;">
            This is an automated message from ${product}. Please do not reply to this email.<br>
            Shah Investors Home Ltd
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}
