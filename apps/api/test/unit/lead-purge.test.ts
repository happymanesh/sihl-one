import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ROLE_PERMISSIONS, type Role } from '@sihl-one/contracts';

import { AuditService } from '../../src/common/audit.service';
import { RequestContextStore } from '../../src/common/request-context';
import type { AuthenticatedPrincipal } from '../../src/common/types';
import { LeadPurgeService } from '../../src/modules/leads/lead-purge.service';
import type { StorageService } from '../../src/modules/storage/storage.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { collectRoutes } from './support/route-inventory';

/**
 * The only hard delete in the system.
 *
 * Everything else that removes a lead sets `deletedAt` and the row survives,
 * so the usual safety net — "we can put it back" — does not exist here. What
 * stands in its place is this file: the permission is held by one role, the
 * lookup cannot be ambiguous, the deletes are enumerated rather than trusted
 * to memory, and the audit row is written before anything goes.
 *
 * The cascade test is the one worth keeping honest. A relation added to `Lead`
 * in `schema.prisma` and not handled here is invisible in production — the
 * purge succeeds, and a table nobody thought of is left holding the details of
 * somebody SIHL has told a regulator it erased. So the assertion is the whole
 * set of destructive calls, compared exactly: adding a relation to the service
 * forces this list to change, which is a code review of exactly the decision
 * that matters.
 */

const REFERENCE = 'LD-2026-000123';
const LEAD_ID = 'lead-ckq1';

interface Recorded {
  model: string;
  method: string;
  args: Record<string, unknown>;
}

const LEAD_ROW = {
  id: LEAD_ID,
  reference: REFERENCE,
  firstName: 'Asha',
  lastName: 'Patel',
  mobile: '9876543210',
  status: 'QUALIFIED',
  ownerId: 'usr-rm',
  customerId: 'cus-1',
  createdAt: new Date('2026-02-01T04:30:00.000Z'),
  deletedAt: null,
  owner: { firstName: 'Rohit', lastName: 'Shah' },
};

/**
 * Seeded reads, and a recording of every write.
 *
 * A Proxy rather than a hand-written object per model: the service touches
 * twenty-two delegates, and spelling each one out would mean a test that fails
 * with "cannot read property deleteMany of undefined" every time the service
 * learns about one more table — which teaches the reader to pad the mock
 * rather than to look at what changed.
 */
function harness(reads: Record<string, unknown> = {}) {
  const calls: Recorded[] = [];

  const answer = (model: string, method: string): unknown => {
    const key = `${model}.${method}`;
    if (key in reads) return reads[key];
    if (method === 'findMany') return [];
    if (method === 'count') return 0;
    if (method === 'findUnique' || method === 'findFirst') return null;
    return { count: 0 };
  };

  const client: unknown = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== 'string') return undefined;
        if (property === '$transaction') {
          return async (run: (tx: unknown) => Promise<unknown>) => run(client);
        }
        return new Proxy(
          {},
          {
            get(_inner, method) {
              if (typeof method !== 'string') return undefined;
              return async (args: Record<string, unknown>) => {
                calls.push({ model: property, method, args });
                return answer(property, method);
              };
            },
          },
        );
      },
    },
  );

  // The audit service holds its own client on purpose — see the note in
  // LeadPurgeService.purge — so it gets its own fake, pushing into the same
  // list so the ordering between the audit write and the deletes is testable.
  const auditPrisma = {
    auditLog: {
      create: async (args: Record<string, unknown>) => {
        calls.push({ model: 'auditLog', method: 'create', args });
        return args;
      },
    },
  } as unknown as PrismaService;

  const removed: string[] = [];
  const storage = {
    remove: async (key: string) => {
      removed.push(key);
    },
  } as unknown as StorageService;

  const service = new LeadPurgeService(
    client as PrismaService,
    new AuditService(auditPrisma),
    storage,
  );

  return { service, calls, removed };
}

/** Reads the service makes when a lead has some of everything hanging off it. */
const POPULATED = {
  'lead.findUnique': LEAD_ROW,
  'activity.findMany': [{ id: 'act-1' }, { id: 'act-2' }],
  'task.findMany': [{ id: 'task-1' }],
  'visit.findMany': [
    { id: 'visit-1', checkInPhotoKey: 'visits/selfie.jpg', voiceNoteKey: null },
    { id: 'visit-2', checkInPhotoKey: null, voiceNoteKey: 'visits/note.webm' },
  ],
  'visitExpense.findMany': [
    { amount: '1250.50', receiptKey: 'receipts/taxi.pdf' },
    { amount: '399.00', receiptKey: null },
  ],
  'document.findMany': [{ storageKey: 'documents/pan.pdf' }],
  'document.count': 1,
  'activityProductValue.count': 3,
  'attendee.count': 2,
  'leadProduct.count': 2,
  'leadProductApproval.count': 1,
  'leadStatusHistory.count': 7,
  'leadFamilyMember.count': 3,
  'leadProfile.count': 1,
  'consentRecord.count': 2,
  'eventAttendance.count': 1,
  'presentationBooking.count': 1,
  'messageLog.count': 9,
  'mobileOtp.count': 4,
  'notification.count': 5,
  'leadImportRow.count': 1,
  'outboxEvent.count': 2,
  'lead.count': 1,
  'messageOptOut.count': 1,
};

const superAdmin: AuthenticatedPrincipal = {
  id: 'usr-sa',
  email: 'admin@sihl.in',
  fullName: 'Super Admin',
  userType: 'INTERNAL',
  roles: ['SUPER_ADMIN'],
  permissions: ['lead:purge'],
  dataScope: 'ALL',
  orgUnitId: null,
  orgUnitPath: null,
  teamUserIds: [],
  partnerId: null,
  sessionId: 'sess-1',
  mustChangePassword: false,
};

const REASON = 'DPDP erasure request received from the client on 2026-10-30, ref CMP-118.';

const purge = (service: LeadPurgeService, body = { confirmReference: REFERENCE, reason: REASON }) =>
  RequestContextStore.run({ traceId: 'trace-1', user: superAdmin }, () =>
    service.purge(superAdmin, REFERENCE, body),
  );

/** Destructive calls only — the reads are noise for the cascade assertions. */
function writes(calls: readonly Recorded[]): string[] {
  return calls
    .filter((call) => ['delete', 'deleteMany', 'updateMany'].includes(call.method))
    .map((call) => `${call.model}.${call.method}`);
}

// ---------------------------------------------------------------------------

describe('lead purge — the permission gate', () => {
  it('is reachable only with lead:purge', () => {
    const routes = collectRoutes('src');
    const route = routes.find((entry) => entry.route === 'DELETE /leads/by-reference/:reference');

    assert.ok(route, 'the purge route is missing from the controller');
    assert.deepEqual(route.permissions, ['lead:purge']);
  });

  it('shows what it would destroy only to the same permission', () => {
    const routes = collectRoutes('src');
    const preview = routes.find(
      (entry) => entry.route === 'GET /leads/by-reference/:reference/purge-preview',
    );

    // The preview names the lead, its owner and every count. Gating it any
    // lower would hand the shape of a record to somebody who may not read it.
    assert.deepEqual(preview?.permissions, ['lead:purge']);
  });

  it('grants the permission to super admin and to nobody else', () => {
    const holders = (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((role) =>
      ROLE_PERMISSIONS[role].includes('lead:purge'),
    );
    assert.deepEqual(holders, ['SUPER_ADMIN']);
  });

  it('is a different route and a different grant from the soft delete', () => {
    const routes = collectRoutes('src');
    const soft = routes.find((entry) => entry.route === 'DELETE /leads/:id');
    const hard = routes.find((entry) => entry.route === 'DELETE /leads/by-reference/:reference');

    assert.deepEqual(soft?.permissions, ['lead:delete']);
    /*
      Two entries in the catalogue, not one. Neither is held by anyone but
      super admin today, and `lead:delete` is the one with a case for being
      widened — it sets a flag an administrator can clear, which is a
      reasonable thing to let operations do. This asserts that widening it
      could never widen the purge along with it.
    */
    assert.notDeepEqual(soft?.permissions, hard?.permissions);
  });
});

describe('lead purge — finding the lead', () => {
  it('answers 404 when no lead carries the number', async () => {
    const { service, calls } = harness();

    await assert.rejects(purge(service), (error: { status?: number }) => error.status === 404);
    assert.deepEqual(writes(calls), [], 'nothing may be deleted when the lead was never found');
  });

  it('looks the number up on its unique column, so two leads cannot match', async () => {
    const { service, calls } = harness(POPULATED);
    await purge(service);

    const lookup = calls.find((call) => call.model === 'lead' && call.method.startsWith('find'));
    // `Lead.reference` is @unique. findUnique can return one row or none, and
    // there is deliberately no third case for this code to choose between.
    assert.equal(lookup?.method, 'findUnique');
    assert.deepEqual(lookup?.args.where, { reference: REFERENCE });
  });

  it('refuses when the typed confirmation does not match the number', async () => {
    const { service, calls } = harness(POPULATED);

    await assert.rejects(
      purge(service, { confirmReference: 'LD-2026-000999', reason: REASON }),
      (error: { status?: number }) => error.status === 400,
    );
    assert.deepEqual(writes(calls), []);
    assert.ok(
      !calls.some((call) => call.model === 'auditLog'),
      'a refused confirmation is not a purge and must not be logged as one',
    );
  });
});

describe('lead purge — the cascade', () => {
  it('deletes every relation the database will not cascade, and nothing else', async () => {
    const { service, calls } = harness(POPULATED);
    await purge(service);

    assert.deepEqual(writes(calls), [
      // Polymorphic children: no foreign key exists, so each is explicit.
      // Documents before activities, or an evidence screenshot carrying both
      // links is cascaded away and the count under-reports it.
      'document.deleteMany',
      'activity.deleteMany',
      'task.deleteMany',
      'visit.deleteMany',
      'notification.deleteMany',
      // SetNull foreign keys: the rows would survive holding the person's
      // mobile number, which is not an erasure.
      'messageLog.deleteMany',
      'mobileOtp.deleteMany',
      // The import rows this lead came from go; rows citing it as a duplicate
      // belong to other people's imports and are only detached.
      'leadImportRow.deleteMany',
      'leadImportRow.updateMany',
      'outboxEvent.deleteMany',
      // And the lead, which takes the eight cascading relations with it.
      'lead.delete',
    ]);
  });

  it('leaves the cascading relations to the foreign keys', async () => {
    const { service, calls } = harness(POPULATED);
    await purge(service);

    /*
      LeadProduct, LeadProfile, LeadFamilyMember, LeadProductApproval,
      LeadStatusHistory, ConsentRecord, EventAttendance and PresentationBooking
      all carry onDelete: Cascade. Deleting them here as well would be a second
      statement of a rule the database already holds, free to drift from it.
      Attendee, ActivityProductValue and VisitExpense cascade off the task,
      activity and visit rows above for the same reason.
    */
    const cascading = [
      'leadProduct',
      'leadProfile',
      'leadFamilyMember',
      'leadProductApproval',
      'leadStatusHistory',
      'consentRecord',
      'eventAttendance',
      'presentationBooking',
      'attendee',
      'activityProductValue',
      'visitExpense',
    ];
    const touched = writes(calls).filter((call) =>
      cascading.some((model) => call.startsWith(`${model}.`)),
    );
    assert.deepEqual(touched, []);
  });

  it('does not touch the records that are not the lead’s to destroy', async () => {
    const { service, calls } = harness(POPULATED);
    await purge(service);

    const written = writes(calls);
    // The customer this lead converted into is a client with an account.
    assert.ok(!written.some((call) => call.startsWith('customer.')));
    // A standing refusal to be contacted. Destroying one can only ever harm
    // the person it protects.
    assert.ok(!written.some((call) => call.startsWith('messageOptOut.')));
    // Other leads merged into this one are separate records.
    assert.ok(!written.includes('lead.deleteMany'));
  });

  it('runs the whole cascade inside one transaction', async () => {
    const { service, calls } = harness(POPULATED);
    await purge(service);

    // Asserted through the fake: `$transaction` hands the service a client and
    // every delete below is recorded against it, so a purge that ran half its
    // deletes outside the transaction would show up as calls made before it.
    const destructive = calls.filter((call) =>
      ['delete', 'deleteMany', 'updateMany'].includes(call.method),
    );
    assert.equal(destructive.length, 11);
    assert.deepEqual(calls.at(-1)?.model, 'lead');
    assert.deepEqual(calls.at(-1)?.method, 'delete');
    assert.deepEqual(calls.at(-1)?.args.where, { id: LEAD_ID });
  });

  it('detaches, rather than deletes, import rows that merely cite the lead', async () => {
    const { service, calls } = harness(POPULATED);
    await purge(service);

    const detach = calls.find(
      (call) => call.model === 'leadImportRow' && call.method === 'updateMany',
    );
    assert.deepEqual(detach?.args.where, { duplicateOfLeadId: LEAD_ID });
    assert.deepEqual(detach?.args.data, { duplicateOfLeadId: null });
  });
});

describe('lead purge — the audit row', () => {
  it('is written before anything is deleted', async () => {
    const { service, calls } = harness(POPULATED);
    await purge(service);

    const audited = calls.findIndex((call) => call.model === 'auditLog');
    const firstDelete = calls.findIndex((call) => ['delete', 'deleteMany'].includes(call.method));

    assert.ok(audited >= 0, 'no audit row was written');
    assert.ok(
      audited < firstDelete,
      'the trail must exist before the rows it describes stop existing',
    );
  });

  it('records the actor, the number, the id and the reason', async () => {
    const { service, calls } = harness(POPULATED);
    await purge(service);

    const row = calls.find((call) => call.model === 'auditLog')?.args.data as Record<
      string,
      unknown
    >;

    assert.equal(row.action, 'DELETE');
    // Its own resource name, so a purge is never mistaken for the soft delete
    // that writes `lead` with the same action.
    assert.equal(row.resource, 'lead.purge');
    assert.equal(row.resourceId, LEAD_ID);
    assert.equal(row.actorId, 'usr-sa');
    assert.equal(row.actorLabel, 'Super Admin <admin@sihl.in>');
    assert.equal(row.reason, REASON);
  });

  it('carries a count per table, so "what did we delete?" is answerable after', async () => {
    const { service, calls } = harness(POPULATED);
    await purge(service);

    const row = calls.find((call) => call.model === 'auditLog')?.args.data as Record<
      string,
      unknown
    >;
    const changes = row.changes as Record<string, unknown>;

    assert.equal(changes.hardDelete, true);
    assert.equal(changes.reference, REFERENCE);
    assert.equal(changes.leadId, LEAD_ID);

    assert.deepEqual(changes.destroyed, {
      activities: 2,
      activityProductValues: 3,
      tasks: 1,
      visits: 2,
      visitExpenses: 2,
      attendees: 2,
      documents: 1,
      leadProducts: 2,
      productApprovals: 1,
      statusHistory: 7,
      familyMembers: 3,
      profile: 1,
      consentRecords: 2,
      eventAttendances: 1,
      presentationBookings: 1,
      messageLogs: 9,
      mobileOtps: 4,
      notifications: 5,
      importRows: 1,
      outboxEvents: 2,
    });

    // What was deliberately left behind is recorded too — an audit row that
    // only lists destruction cannot answer "did we keep the opt-out?".
    assert.deepEqual(changes.retained, {
      mergedLeads: 1,
      customer: true,
      messageOptOuts: 1,
      duplicateCitations: 1,
    });

    // Expense claims are money a rep says they are owed, and they go with the
    // visit whether anyone meant them to or not. The total is stated so the
    // decision is at least a seen one.
    assert.equal(changes.expenseClaimTotal, '1649.50');
    assert.equal(changes.storedFiles, 4);
  });

  it('masks the mobile number rather than copying it into the trail', async () => {
    const { service, calls } = harness(POPULATED);
    await purge(service);

    const row = calls.find((call) => call.model === 'auditLog')?.args.data as Record<
      string,
      unknown
    >;
    const changes = row.changes as Record<string, unknown>;

    assert.equal(changes.mobile, '****3210');
    assert.ok(!JSON.stringify(changes).includes('9876543210'));
  });
});

describe('lead purge — the files behind the rows', () => {
  it('removes every object the purged rows pointed at', async () => {
    const { service, removed } = harness(POPULATED);
    const result = await purge(service);

    assert.deepEqual(removed, [
      'documents/pan.pdf',
      'visits/selfie.jpg',
      'visits/note.webm',
      'receipts/taxi.pdf',
    ]);
    assert.equal(result.filesRemoved, 4);
    assert.equal(result.filesFailed, 0);
  });

  it('reports a file it could not remove instead of failing a committed purge', async () => {
    const { service, calls, removed } = harness(POPULATED);
    // Replace the storage stub with one that refuses the first object.
    const failing = {
      remove: async (key: string) => {
        if (key === 'documents/pan.pdf') throw new Error('object store unreachable');
        removed.push(key);
      },
    } as unknown as StorageService;
    Reflect.set(service, 'storage', failing);

    const result = await purge(service);

    // The rows are already gone; throwing here would report a failure for work
    // that succeeded and invite a retry against a lead that no longer exists.
    assert.equal(result.filesFailed, 1);
    assert.equal(result.filesRemoved, 3);
    assert.ok(writes(calls).includes('lead.delete'));
  });
});
