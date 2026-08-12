import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  auditQuerySchema,
  isSecurityRelevant,
  summariseAuditEntry,
} from '../src/audit';

describe('audit query', () => {
  it('accepts an empty query and defaults the page', () => {
    const parsed = auditQuerySchema.parse({});
    assert.equal(parsed.page, 1);
    assert.ok(parsed.pageSize > 0);
  });

  it('coerces dates and the security flag from query strings', () => {
    const parsed = auditQuerySchema.parse({ from: '2026-07-01', securityOnly: 'true' });
    assert.ok(parsed.from instanceof Date);
    assert.equal(parsed.securityOnly, true);
  });

  it('rejects an unknown action', () => {
    assert.equal(auditQuerySchema.safeParse({ action: 'TAMPER' }).success, false);
  });
});

describe('summaries', () => {
  it('names the actor from the label snapshot', () => {
    const summary = summariseAuditEntry({
      action: 'UPDATE',
      resource: 'lead',
      actorLabel: 'Priya Desai <salesmanager@sihl.in>',
      changes: { status: { from: 'NEW', to: 'CONTACTED' } },
    });
    assert.match(summary, /^Priya Desai updated a lead/);
    // The email is in the label but must not be in the sentence.
    assert.equal(/@/.test(summary), false);
  });

  it('falls back to the system when there is no actor', () => {
    const summary = summariseAuditEntry({ action: 'CREATE', resource: 'lead' });
    assert.match(summary, /^The system created a lead/);
  });

  it('lists a few changed fields and counts many', () => {
    const few = summariseAuditEntry({
      action: 'UPDATE',
      resource: 'customer',
      changes: { city: { from: 'A', to: 'B' }, state: { from: 'C', to: 'D' } },
    });
    assert.match(few, /\(city, state\)/);

    const many = summariseAuditEntry({
      action: 'UPDATE',
      resource: 'customer',
      changes: Object.fromEntries(
        ['a', 'b', 'c', 'd', 'e'].map((key) => [key, { from: 1, to: 2 }]),
      ),
    });
    assert.match(many, /\(5 fields\)/);
  });

  it('does not say "a auth" for sign-in events', () => {
    for (const action of ['LOGIN', 'LOGOUT', 'LOGIN_FAILED']) {
      const summary = summariseAuditEntry({ action, resource: 'auth', actorLabel: 'Rahul <r@x>' });
      assert.equal(/a auth/.test(summary), false, action);
      assert.match(summary, /Rahul/);
    }
  });

  it('picks the right article for the noun', () => {
    const audit = summariseAuditEntry({ action: 'READ', resource: 'audit_log' });
    assert.match(audit, /an audit log/);
    const lead = summariseAuditEntry({ action: 'READ', resource: 'lead' });
    assert.match(lead, /a lead/);
  });

  it('reads dotted resource names as words', () => {
    const summary = summariseAuditEntry({ action: 'READ', resource: 'performance.scorecard' });
    assert.match(summary, /performance scorecard/);
  });

  it('never returns an empty or unterminated sentence', () => {
    for (const action of ['CREATE', 'ASSIGN', 'EXPORT', 'SOMETHING_NEW']) {
      const summary = summariseAuditEntry({ action, resource: 'lead' });
      assert.ok(summary.length > 10);
      assert.ok(summary.endsWith('.'));
    }
  });
});

describe('security relevance', () => {
  it('flags failed logins, denials, exports and deletes', () => {
    for (const action of ['LOGIN_FAILED', 'PERMISSION_DENIED', 'EXPORT', 'DELETE']) {
      assert.equal(isSecurityRelevant(action, 'lead'), true, action);
    }
  });

  it('flags the notice-period export row whatever its action', () => {
    assert.equal(isSecurityRelevant('CREATE', 'security.export_during_notice'), true);
  });

  it('leaves ordinary work alone', () => {
    assert.equal(isSecurityRelevant('UPDATE', 'lead'), false);
    assert.equal(isSecurityRelevant('LOGIN', 'auth'), false);
  });
});

describe('permission denials', () => {
  it('names the missing permission rather than the controller', () => {
    // "Denied access to a CampaignsController" tells a compliance reader
    // nothing they can act on; the permission name tells them what to grant.
    const summary = summariseAuditEntry({
      action: 'PERMISSION_DENIED',
      resource: 'permission',
      resourceId: 'campaign:read',
      actorLabel: 'Priya Desai <p@sihl.in>',
    });
    assert.equal(summary, 'Priya Desai was denied campaign:read.');
  });

  it('still reads as a sentence with no permission recorded', () => {
    const summary = summariseAuditEntry({ action: 'PERMISSION_DENIED', resource: 'permission' });
    assert.ok(summary.endsWith('.'));
    assert.equal(/undefined|null/.test(summary), false);
  });
});
