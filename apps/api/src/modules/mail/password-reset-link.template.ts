import { escapeHtml, istTimestamp, type RenderedEmail } from './password-reset.template';

/**
 * The email somebody gets when *they* asked to reset their own password.
 *
 * Deliberately a separate template from the administrator-initiated one beside
 * it, which carries a temporary password. The two messages differ in the thing
 * that matters most: this one hands over a single-use link and no credential at
 * all, so a forwarded copy or a mail archive is worth nothing once the link is
 * spent or expires.
 *
 * A pure function — facts in, a subject and two bodies out. Nothing here
 * touches the network or the clock.
 */

export interface PasswordResetLinkEmailInput {
  firstName: string;
  /** Employee code where there is one; it is what people sign in with. */
  employeeCode: string | null;
  email: string;
  /** Absolute URL, already carrying the token. */
  resetUrl: string;
  /** Minutes the link stays valid, stated plainly in the body. */
  validForMinutes: number;
  when: Date;
  productName: string;
}

export function passwordResetLinkEmail(input: PasswordResetLinkEmailInput): RenderedEmail {
  const { firstName, resetUrl, validForMinutes, productName } = input;
  const stamp = istTimestamp(input.when);
  const username = input.employeeCode ?? input.email;

  const subject = `Reset your ${productName} password`;

  const text = `Hello ${firstName},

Someone asked to reset the password for your ${productName} account on ${stamp} IST.

Your username is ${username}.

Open this link to set a new password. It works once and expires in ${validForMinutes} minutes:

${resetUrl}

Once you set a new password you will be signed out everywhere, on every device.

If this was not you, you do not need to do anything — the link above is the only
thing that was issued, your current password still works, and the link will
expire on its own. Tell your support desk if you get these unexpectedly.

This is an automated message from ${productName}. Please do not reply.

Shah Investors Home Ltd`;

  const name = escapeHtml(firstName);
  const product = escapeHtml(productName);
  const url = escapeHtml(resetUrl);
  const minutes = String(validForMinutes);

  // Table layout with inline styles, matching the sibling template: Outlook
  // ignores <style> blocks and most of flexbox, and this has to survive a
  // desktop client as well as a phone.
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
          <h1 style="margin:0;font-size:20px;line-height:1.3;font-weight:700;">Reset your password</h1>
        </td></tr>
        <tr><td style="padding:14px 28px 0;font-size:15px;line-height:1.6;">
          <p style="margin:0 0 14px;">Hello ${name},</p>
          <p style="margin:0 0 14px;">Someone asked to reset the password for your ${product} account.</p>
          <p style="margin:0 0 6px;font-size:13px;color:#52606d;">When</p>
          <p style="margin:0 0 16px;font-weight:600;">${stamp} IST</p>
        </td></tr>
        <tr><td style="padding:0 28px 14px;">
          <p style="margin:0 0 6px;font-size:13px;color:#52606d;">Username</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f9fc;border:1px solid #cfd8e3;border-radius:6px;">
            <tr><td align="center" style="padding:12px 16px;font-family:Consolas,Menlo,Monaco,'Courier New',monospace;font-size:17px;font-weight:700;letter-spacing:.05em;color:#0f2e5c;">${escapeHtml(username)}</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:4px 28px 0;" align="center">
          <a href="${url}" style="display:inline-block;background:#0f2e5c;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:11px 26px;border-radius:6px;">Set a new password</a>
        </td></tr>
        <tr><td style="padding:14px 28px 0;font-size:13px;line-height:1.6;color:#52606d;" align="center">
          <p style="margin:0;">This link works once and expires in ${minutes} minutes.</p>
        </td></tr>
        <tr><td style="padding:18px 28px 0;font-size:14px;line-height:1.6;color:#52606d;">
          <p style="margin:0;">If the button does not work, copy this into your browser:</p>
          <p style="margin:6px 0 0;word-break:break-all;font-size:13px;">${url}</p>
        </td></tr>
        <tr><td style="padding:18px 28px 0;font-size:14px;line-height:1.6;color:#52606d;">
          <p style="margin:0;">Once you set a new password you will be signed out on every device.</p>
        </td></tr>
        <tr><td style="padding:18px 28px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff8f0;border:1px solid #f0d5b8;border-radius:6px;">
            <tr><td style="padding:14px 16px;font-size:14px;line-height:1.6;">
              <strong style="display:block;margin-bottom:6px;">If this was not you</strong>
              You do not need to do anything. Your current password still works, nothing has been
              changed, and the link above expires on its own. Tell your support desk if you receive
              these unexpectedly.
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
