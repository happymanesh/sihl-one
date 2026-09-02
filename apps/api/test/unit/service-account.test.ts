import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  REPORTING_PERMISSIONS,
  createServiceAccountSchema,
  isPermissionAllowedForService,
  serviceAccountUsable,
} from '@sihl-one/contracts';

describe('service account permissions', () => {
  it('allows the reporting permissions the CEO command centre needs', () => {
    for (const permission of REPORTING_PERMISSIONS) {
      assert.equal(isPermissionAllowedForService(permission), true, permission);
    }
  });

  it('refuses every write permission', () => {
    for (const permission of ['lead:create', 'lead:convert', 'lead:assign', 'lead:delete']) {
      assert.equal(isPermissionAllowedForService(permission), false, permission);
    }
  });

  it('refuses export, which is a bulk read of client PII', () => {
    assert.equal(isPermissionAllowedForService('lead:export'), false);
    assert.equal(isPermissionAllowedForService('customer:export'), false);
  });

  it('refuses audit:read even though it is a read', () => {
    assert.equal(isPermissionAllowedForService('audit:read'), false);
  });

  it('refuses a permission that does not exist', () => {
    assert.equal(isPermissionAllowedForService('everything:read'), false);
  });
});

describe('createServiceAccountSchema', () => {
  const base = {
    name: 'ceo-command-centre',
    permissions: [...REPORTING_PERMISSIONS],
    expiresAt: '2027-09-02T00:00:00.000Z',
  };

  it('accepts a reporting integration', () => {
    const parsed = createServiceAccountSchema.parse(base);
    assert.equal(parsed.dataScope, 'ALL');
    assert.equal(parsed.name, 'ceo-command-centre');
  });

  it('rejects a write permission smuggled in beside the reads', () => {
    const result = createServiceAccountSchema.safeParse({
      ...base,
      permissions: [...REPORTING_PERMISSIONS, 'lead:create'],
    });
    assert.equal(result.success, false);
  });

  it('requires an expiry', () => {
    const { expiresAt: _dropped, ...withoutExpiry } = base;
    assert.equal(createServiceAccountSchema.safeParse(withoutExpiry).success, false);
  });

  it('requires at least one permission', () => {
    assert.equal(
      createServiceAccountSchema.safeParse({ ...base, permissions: [] }).success,
      false,
    );
  });

  it('rejects a name that is not a machine name', () => {
    assert.equal(
      createServiceAccountSchema.safeParse({ ...base, name: 'CEO Command Centre' }).success,
      false,
    );
  });
});

describe('serviceAccountUsable', () => {
  const now = new Date('2026-09-02T10:00:00.000Z');
  const live = { isActive: true, revokedAt: null, expiresAt: new Date('2027-01-01T00:00:00Z') };

  it('accepts a live key', () => {
    assert.equal(serviceAccountUsable(live, now).usable, true);
  });

  it('refuses a revoked key even while it is otherwise valid', () => {
    assert.equal(serviceAccountUsable({ ...live, revokedAt: now }, now).usable, false);
  });

  it('refuses a disabled key', () => {
    assert.equal(serviceAccountUsable({ ...live, isActive: false }, now).usable, false);
  });

  it('refuses an expired key', () => {
    const expired = { ...live, expiresAt: new Date('2026-08-01T00:00:00Z') };
    assert.equal(serviceAccountUsable(expired, now).usable, false);
  });

  it('treats the expiry instant itself as expired', () => {
    assert.equal(serviceAccountUsable({ ...live, expiresAt: now }, now).usable, false);
  });
});
