import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { diffRecords, sanitiseForAudit } from '../../src/common/audit.service';

/**
 * The audit trail is read by more people than the source tables are. If PII
 * leaks into it, it has quietly widened who can see that data — so redaction is
 * tested rather than assumed.
 */
describe('audit redaction', () => {
  it('never records a password or a hash', () => {
    const output = sanitiseForAudit({
      email: 'asha@example.com',
      password: 'CorrectHorse9!x',
      passwordHash: '$argon2id$v=19$…',
    }) as Record<string, unknown>;

    assert.equal(output.password, '[redacted]');
    assert.equal(output.passwordHash, '[redacted]');
  });

  it('never records a full PAN or date of birth', () => {
    const output = sanitiseForAudit({ pan: 'ABCDE1234F', dateOfBirth: '1974-04-01' }) as Record<
      string,
      unknown
    >;
    assert.equal(output.pan, '[redacted]');
    assert.equal(output.dateOfBirth, '[redacted]');
  });

  it('masks rather than drops contact details, so a change is still auditable', () => {
    const output = sanitiseForAudit({
      mobile: '9876543210',
      email: 'asha.patel@example.com',
    }) as Record<string, unknown>;

    assert.equal(output.mobile, '****3210');
    assert.equal(output.email, 'as***@example.com');
  });

  it('redacts nested objects too', () => {
    const output = sanitiseForAudit({
      lead: { firstName: 'Asha', pan: 'ABCDE1234F' },
    }) as { lead: Record<string, unknown> };

    assert.equal(output.lead.firstName, 'Asha');
    assert.equal(output.lead.pan, '[redacted]');
  });

  it('does not recurse without bound', () => {
    // A cyclic or very deep object must not take the process down; the audit
    // write is on the request path.
    let deep: Record<string, unknown> = { value: 'bottom' };
    for (let index = 0; index < 12; index += 1) deep = { nested: deep };
    assert.doesNotThrow(() => sanitiseForAudit(deep));
  });
});

describe('audit diffing', () => {
  it('records only the fields that changed', () => {
    const changes = diffRecords(
      { status: 'NEW', priority: 'LOW', firstName: 'Asha' },
      { status: 'CONTACTED', priority: 'LOW', firstName: 'Asha' },
    );
    assert.deepEqual(changes, { status: { from: 'NEW', to: 'CONTACTED' } });
  });

  it('returns null when nothing changed, so no audit row is written', () => {
    assert.equal(diffRecords({ status: 'NEW' }, { status: 'NEW' }), null);
  });

  it('ignores updatedAt, which changes on every write and means nothing', () => {
    const changes = diffRecords(
      { status: 'NEW', updatedAt: '2026-01-01' },
      { status: 'NEW', updatedAt: '2026-01-02' },
    );
    assert.equal(changes, null);
  });

  it('masks PII inside a diff', () => {
    const changes = diffRecords({ mobile: '9876543210' }, { mobile: '9123456789' });
    assert.deepEqual(changes, { mobile: { from: '****3210', to: '****6789' } });
  });
});
