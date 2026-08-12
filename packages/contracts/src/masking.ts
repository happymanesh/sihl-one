/**
 * PII masking helpers.
 *
 * These run on the API side before serialisation, not in the browser. Masking
 * in the client would still put the full value on the wire, where it lands in
 * browser caches, proxy logs and anyone's devtools — which is precisely what a
 * DPDP/SEBI reviewer will ask about.
 *
 * Full values are returned only from single-record endpoints, only to callers
 * holding the record-level permission, and every such read is audited.
 */

export function maskMobile(mobile: string | null | undefined): string {
  if (!mobile) return '';
  const digits = mobile.replace(/\D/g, '');
  if (digits.length < 4) return '••••';
  return `${'•'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

export function maskEmail(email: string | null | undefined): string {
  if (!email) return '';
  const [local = '', domain = ''] = email.split('@');
  if (!domain) return '••••';
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${'•'.repeat(Math.max(2, local.length - head.length))}@${domain}`;
}

/** PAN: first three and the final check letter survive; the rest is masked. */
export function maskPan(pan: string | null | undefined): string {
  if (!pan || pan.length !== 10) return '';
  return `${pan.slice(0, 3)}••••${pan.slice(-1)}`;
}

export function maskAccountNumber(value: string | null | undefined): string {
  if (!value) return '';
  return value.length <= 4 ? '••••' : `••••${value.slice(-4)}`;
}
