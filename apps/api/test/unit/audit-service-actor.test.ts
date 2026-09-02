import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AuditService } from '../../src/common/audit.service';
import { RequestContextStore } from '../../src/common/request-context';
import type { AuthenticatedPrincipal } from '../../src/common/types';
import type { PrismaService } from '../../src/prisma/prisma.service';

/**
 * `AuditLog.actorId` is a foreign key into `app_user`. A service account is a
 * real actor but not a row in that table, so writing its id there violates the
 * constraint — and because `AuditService.record` deliberately swallows every
 * error rather than failing the user's operation, the violation would surface
 * as a silently missing audit row. That is the worst possible failure for a
 * compliance record, which is why it is pinned here.
 */
function auditWith(captured: { data?: Record<string, unknown> }) {
  const prisma = {
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        captured.data = data;
        return data;
      },
    },
  } as unknown as PrismaService;
  return new AuditService(prisma);
}

const base = {
  roles: [],
  permissions: [],
  dataScope: 'ALL' as const,
  orgUnitId: null,
  orgUnitPath: null,
  teamUserIds: [],
  partnerId: null,
  mustChangePassword: false,
};

const service: AuthenticatedPrincipal = {
  ...base,
  id: 'svc_ckq1',
  email: 'ceo-command-centre@service.sihl.internal',
  fullName: 'Service: ceo-command-centre',
  userType: 'INTERNAL',
  sessionId: 'svc_ckq1',
  isService: true,
};

const person: AuthenticatedPrincipal = {
  ...base,
  id: 'usr_ckq2',
  email: 'asha@sihl.in',
  fullName: 'Asha Patel',
  userType: 'INTERNAL',
  sessionId: 'sess_1',
};

const run = async (user: AuthenticatedPrincipal, captured: { data?: Record<string, unknown> }) =>
  RequestContextStore.run({ traceId: 't-1', user }, async () => {
    await auditWith(captured).record({ action: 'READ', resource: 'dashboard' });
  });

describe('audit attribution', () => {
  it('leaves actorId null for a service account, so the foreign key holds', async () => {
    const captured: { data?: Record<string, unknown> } = {};
    await run(service, captured);
    assert.equal(captured.data?.actorId, null);
  });

  it('still names the service in the label, so the trail is not anonymous', async () => {
    const captured: { data?: Record<string, unknown> } = {};
    await run(service, captured);
    assert.match(String(captured.data?.actorLabel), /^Service: ceo-command-centre </);
  });

  it('still records actorId for a person', async () => {
    const captured: { data?: Record<string, unknown> } = {};
    await run(person, captured);
    assert.equal(captured.data?.actorId, 'usr_ckq2');
    assert.equal(captured.data?.actorLabel, 'Asha Patel <asha@sihl.in>');
  });
});
