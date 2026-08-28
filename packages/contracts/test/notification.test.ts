import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  NOTIFICATION_RETENTION_DAYS,
  NOTIFICATION_TYPES,
  notificationsFor,
  type RoutableEvent,
} from '../src/notification';

const event = (over: Partial<RoutableEvent> & Pick<RoutableEvent, 'eventType'>): RoutableEvent => ({
  aggregateType: 'lead',
  aggregateId: 'lead-1',
  payload: {},
  actorId: 'manager-1',
  ...over,
});

/**
 * The rule the whole feature rests on.
 *
 * A bell that fills with a person's own clicks is one they stop reading, and a
 * notification centre nobody reads is worse than none — it absorbs the budget
 * and the trust that a working one would have had.
 */
describe('never notify the actor of their own action', () => {
  it('says nothing when a rep assigns a lead to themselves', () => {
    const out = notificationsFor(
      event({ eventType: 'lead.assigned', actorId: 'rep-1', payload: { to: 'rep-1' } }),
    );
    assert.deepEqual(out, []);
  });

  it('says nothing when a rep transfers a lead they own to themselves', () => {
    const out = notificationsFor(
      event({
        eventType: 'lead.transferred',
        actorId: 'rep-1',
        payload: { from: 'rep-1', to: 'rep-1' },
      }),
    );
    assert.deepEqual(out, []);
  });

  it('still notifies the other party when the actor is one side of a transfer', () => {
    // A rep handing their own lead away: they know, the receiver does not.
    const out = notificationsFor(
      event({
        eventType: 'lead.transferred',
        actorId: 'rep-1',
        payload: { from: 'rep-1', to: 'rep-2' },
      }),
    );
    assert.equal(out.length, 1);
    assert.equal(out[0]!.userId, 'rep-2');
    assert.equal(out[0]!.type, 'LEAD_TRANSFERRED_IN');
  });

  it('notifies a rep whose task was created for them by somebody else', () => {
    const out = notificationsFor(
      event({
        eventType: 'task.assigned',
        aggregateType: 'task',
        aggregateId: 'task-1',
        actorId: 'manager-1',
        payload: { assigneeId: 'rep-1', title: 'Collect PAN copy' },
      }),
    );
    assert.equal(out.length, 1);
    assert.equal(out[0]!.userId, 'rep-1');
    assert.equal(out[0]!.title, 'Task: Collect PAN copy');
  });

  it('says nothing for a task somebody books for themselves', () => {
    // The overwhelmingly common case — a rep setting their own follow-up.
    const out = notificationsFor(
      event({
        eventType: 'task.assigned',
        actorId: 'rep-1',
        payload: { assigneeId: 'rep-1', title: 'Call back Tuesday' },
      }),
    );
    assert.deepEqual(out, []);
  });
});

describe('assignment', () => {
  it('notifies the new owner', () => {
    const out = notificationsFor(
      event({ eventType: 'lead.assigned', payload: { reference: 'LD-2026-000118', to: 'rep-1' } }),
    );
    assert.equal(out.length, 1);
    assert.deepEqual(
      { userId: out[0]!.userId, type: out[0]!.type, entityId: out[0]!.entityId },
      { userId: 'rep-1', type: 'LEAD_ASSIGNED', entityId: 'lead-1' },
    );
    assert.match(out[0]!.title, /LD-2026-000118/);
  });

  it('falls back to the aggregate id when the payload carries no reference', () => {
    const out = notificationsFor(event({ eventType: 'lead.assigned', payload: { to: 'rep-1' } }));
    assert.match(out[0]!.title, /lead-1/);
  });

  it('says nothing when the payload has no recipient', () => {
    assert.deepEqual(notificationsFor(event({ eventType: 'lead.assigned', payload: {} })), []);
  });
});

describe('transfer tells both sides', () => {
  it('notifies receiver and previous owner', () => {
    const out = notificationsFor(
      event({
        eventType: 'lead.transferred',
        payload: { reference: 'LD-2026-000118', from: 'rep-1', to: 'rep-2', reason: 'Moved branch' },
      }),
    );
    assert.equal(out.length, 2);
    assert.deepEqual(
      out.map((n) => [n.userId, n.type]),
      [
        ['rep-2', 'LEAD_TRANSFERRED_IN'],
        ['rep-1', 'LEAD_TRANSFERRED_AWAY'],
      ],
    );
    // The reason is carried through: losing a lead without one reads as a slight.
    assert.equal(out[0]!.body, 'Moved branch');
    assert.equal(out[1]!.body, 'Moved branch');
  });

  it('does not notify a previous owner who is also the new owner', () => {
    const out = notificationsFor(
      event({ eventType: 'lead.transferred', payload: { from: 'rep-2', to: 'rep-2' } }),
    );
    assert.equal(out.length, 1);
    assert.equal(out[0]!.type, 'LEAD_TRANSFERRED_IN');
  });

  it('handles a lead that had no previous owner', () => {
    const out = notificationsFor(
      event({ eventType: 'lead.transferred', payload: { from: null, to: 'rep-2' } }),
    );
    assert.equal(out.length, 1);
    assert.equal(out[0]!.userId, 'rep-2');
  });
});

describe('import and offboarding', () => {
  it('notifies the batch assignee, with the count when present', () => {
    const out = notificationsFor(
      event({
        eventType: 'lead.import.committed',
        aggregateType: 'import',
        aggregateId: 'imp-1',
        payload: { assigneeId: 'rep-1', created: '48' },
      }),
    );
    assert.equal(out.length, 1);
    assert.equal(out[0]!.title, '48 imported leads assigned to you');
  });

  it('says nothing for an import nobody was assigned', () => {
    assert.deepEqual(
      notificationsFor(event({ eventType: 'lead.import.committed', payload: { created: '48' } })),
      [],
    );
  });

  it('notifies the successor inheriting a book', () => {
    const out = notificationsFor(
      event({
        eventType: 'user.offboarded',
        aggregateType: 'user',
        aggregateId: 'user-9',
        payload: { successorId: 'rep-1' },
      }),
    );
    assert.equal(out[0]!.type, 'BOOK_INHERITED');
    assert.equal(out[0]!.userId, 'rep-1');
  });
});

describe('everything else stays quiet', () => {
  it('produces nothing for the events that are not news to a person', () => {
    // Eight of the thirteen. Named individually so that adding one to the
    // routing is a deliberate act with a failing test, not a silent change of
    // how noisy the product is.
    for (const eventType of [
      'lead.created',
      'lead.captured',
      'lead.converted',
      'lead.merged',
      'customer.created',
      'campaign.created',
      'event.created',
      'visit.checked_in',
      'visit.completed',
    ]) {
      assert.deepEqual(
        notificationsFor(event({ eventType, payload: { to: 'rep-1', assigneeId: 'rep-1' } })),
        [],
        `${eventType} should not notify`,
      );
    }
  });

  it('survives a payload that is not an object', () => {
    for (const payload of [null, undefined, 'string', 42, []]) {
      assert.doesNotThrow(() => notificationsFor(event({ eventType: 'lead.assigned', payload })));
      assert.deepEqual(notificationsFor(event({ eventType: 'lead.assigned', payload })), []);
    }
  });

  it('ignores blank strings in a payload rather than addressing nobody', () => {
    assert.deepEqual(
      notificationsFor(event({ eventType: 'lead.assigned', payload: { to: '   ' } })),
      [],
    );
  });
});

describe('housekeeping', () => {
  it('every routed type is declared', () => {
    const declared = new Set<string>(NOTIFICATION_TYPES);
    const routed = [
      ...notificationsFor(event({ eventType: 'lead.assigned', payload: { to: 'a' } })),
      ...notificationsFor(event({ eventType: 'lead.transferred', payload: { from: 'a', to: 'b' } })),
      ...notificationsFor(event({ eventType: 'task.assigned', payload: { assigneeId: 'a' } })),
      ...notificationsFor(event({ eventType: 'lead.import.committed', payload: { assigneeId: 'a' } })),
      ...notificationsFor(event({ eventType: 'user.offboarded', payload: { successorId: 'a' } })),
    ];
    assert.equal(routed.length, 6, 'five events, six notifications — transfer tells both sides');
    for (const n of routed) assert.ok(declared.has(n.type), `${n.type} is not in NOTIFICATION_TYPES`);
  });

  it('keeps notifications for a bounded period', () => {
    assert.equal(NOTIFICATION_RETENTION_DAYS, 90);
    assert.ok(NOTIFICATION_RETENTION_DAYS > 0);
  });
});
