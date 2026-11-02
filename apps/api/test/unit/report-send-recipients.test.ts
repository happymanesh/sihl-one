import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { ROLE_PERMISSIONS, sendPerformanceReportSchema, type Role } from '@sihl-one/contracts';

import { AuditService } from '../../src/common/audit.service';
import type { ScopeService } from '../../src/common/scope.service';
import type { Mailer } from '../../src/modules/mail/mailer';
import { PerformanceReportService } from '../../src/modules/performance/performance-report.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { collectRoutes } from './support/route-inventory';

/**
 * Emailing a performance report, and who it may be emailed to.
 *
 * The route used to take a hundred `to` addresses, fifty `cc`, and a hundred
 * kilobytes of caller-supplied body, guarded by `analytics:sales:read` — a
 * permission five roles hold, including every sales executive. Nothing checked
 * that a recipient worked at SIHL. That made a reporting screen into a mail
 * relay signing as SIHL, reachable by nearly anybody who could log in.
 *
 * Both halves of the fix are pinned here, because either one alone leaves it
 * open: a narrower permission still lets a sales manager mail the firm's
 * numbers anywhere, and a recipient check on a permission everybody holds
 * still lets a rep mail appraisals of their colleagues around the company.
 */

function harness(directory: Array<{ email: string }>) {
  const queries: Array<Record<string, unknown>> = [];
  const sent: Array<Record<string, unknown>> = [];
  const audited: Array<Record<string, unknown>> = [];

  const prisma = {
    user: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        queries.push(args.where);
        return directory;
      },
    },
  } as unknown as PrismaService;

  const mailer = {
    send: async (message: Record<string, unknown>) => {
      sent.push(message);
      return { accepted: true, providerMessageId: 'msg-1', failureReason: null };
    },
  } as unknown as Mailer;

  const auditPrisma = {
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audited.push(data);
        return data;
      },
    },
  } as unknown as PrismaService;

  const scope = {} as unknown as ScopeService;

  const service = new PerformanceReportService(
    prisma,
    scope,
    mailer,
    new AuditService(auditPrisma),
  );

  return { service, queries, sent, audited };
}

const actor = {
  id: 'usr-mgr',
  email: 'manager@sihl.in',
  fullName: 'Team Manager',
} as never;

/** The field-keyed errors off a Nest exception payload. */
function fieldErrors(error: unknown): Record<string, string[]> {
  assert.ok(error instanceof BadRequestException, 'expected a 400');
  const body = error.getResponse() as { errors?: Record<string, string[]> };
  return body.errors ?? {};
}

const payload = (overrides: Record<string, unknown> = {}) =>
  sendPerformanceReportSchema.parse({
    to: ['asha@sihl.in'],
    cc: [],
    subject: 'October performance',
    body: 'Numbers for the month.',
    ...overrides,
  });

// ---------------------------------------------------------------------------

describe('performance report — who may send it', () => {
  it('is no longer reachable on a read permission', () => {
    const route = collectRoutes('src').find(
      (entry) => entry.route === 'POST /performance/report/send',
    );

    assert.deepEqual(route?.permissions, ['report:send']);
  });

  it('is held by the roles whose job it is, and not by a sales executive', () => {
    const holders = (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((role) =>
      ROLE_PERMISSIONS[role].includes('report:send'),
    );

    assert.deepEqual(holders.sort(), ['MANAGEMENT', 'OPERATIONS', 'SALES_MANAGER', 'SUPER_ADMIN']);

    // Spelled out, because this is the case that mattered: a rep is one of the
    // people the report is about.
    assert.ok(!ROLE_PERMISSIONS.SALES_EXECUTIVE.includes('report:send'));
    assert.ok(!ROLE_PERMISSIONS.MARKETING.includes('report:send'));
    // And they all still hold the read, which is what made the old guard useless.
    assert.ok(ROLE_PERMISSIONS.SALES_EXECUTIVE.includes('analytics:sales:read'));
  });
});

describe('performance report — who it may be sent to', () => {
  it('sends when every recipient is an active internal user', async () => {
    const { service, sent } = harness([{ email: 'asha@sihl.in' }]);

    const result = await service.send(actor, payload());

    assert.equal(result.sent, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.to, 'asha@sihl.in');
  });

  it('refuses an address that is not a SIHL user, and names it', async () => {
    const { service, sent } = harness([{ email: 'asha@sihl.in' }]);

    await assert.rejects(
      service.send(actor, payload({ to: ['asha@sihl.in', 'outsider@gmail.com'] })),
      (error: unknown) => {
        assert.match(String(fieldErrors(error).to?.[0]), /outsider@gmail\.com/);
        return true;
      },
    );

    // Nothing may be sent to the good addresses either. A report that reached
    // half its recipients, with the sender told it failed, is the worst outcome.
    assert.deepEqual(sent, []);
  });

  it('checks the cc list too, and blames the right field', async () => {
    const { service } = harness([{ email: 'asha@sihl.in' }]);

    await assert.rejects(
      service.send(actor, payload({ cc: ['someone@elsewhere.com'] })),
      (error: unknown) => {
        const errors = fieldErrors(error);
        assert.ok(errors.cc, 'the cc field should carry the error');
        assert.ok(!errors.to, 'the to field was fine and should not be marked');
        return true;
      },
    );
  });

  it('asks only for active, internal, undeleted users', async () => {
    const { service, queries } = harness([{ email: 'asha@sihl.in' }]);
    await service.send(actor, payload());

    assert.deepEqual(queries[0], {
      email: { in: ['asha@sihl.in'] },
      userType: 'INTERNAL',
      status: 'ACTIVE',
      deletedAt: null,
    });
  });

  it('matches an address whatever case it was typed in', async () => {
    // The schema lower-cases at the boundary, as sign-in does, so the exact
    // match against a lower-cased column holds.
    const { service, sent } = harness([{ email: 'asha@sihl.in' }]);
    await service.send(actor, payload({ to: ['Asha@SIHL.in'] }));

    assert.equal(sent[0]?.to, 'asha@sihl.in');
  });

  it('records the addresses in the audit row, not just how many', async () => {
    const { service, audited } = harness([{ email: 'asha@sihl.in' }, { email: 'head@sihl.in' }]);
    await service.send(actor, payload({ to: ['asha@sihl.in'], cc: ['head@sihl.in'] }));

    const changes = audited[0]?.changes as Record<string, unknown>;
    assert.equal(audited[0]?.action, 'EXPORT');
    // "Where did this team's performance go" is not answerable from a count.
    assert.deepEqual(changes.recipients, ['asha@sihl.in']);
    assert.deepEqual(changes.ccRecipients, ['head@sihl.in']);
  });
});
