import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createFollowUpTask, followUpTaskTitle } from '../../src/modules/tasks/follow-up-task';

/**
 * A follow-up booked at the end of a visit used to write a date onto the lead
 * and nothing else, so the rep who made the promise never saw it on the screen
 * they actually work from. These cover the two things that made it a defect:
 * that a task is written at all, and that it is written for the person who owns
 * the follow-through rather than whoever happened to be clicking.
 */
describe('follow-up task title', () => {
  it('names the commitment after what produced it', () => {
    assert.equal(followUpTaskTitle('collect document'), 'Follow up: collect document');
  });

  it('survives a purpose longer than the column', () => {
    const title = followUpTaskTitle('x'.repeat(400));
    assert.ok(title.length <= 160, `title was ${title.length} characters`);
    assert.ok(title.endsWith('…'), 'a truncated title should read as truncated');
  });

  it('does not produce a dangling prefix when there is no context', () => {
    assert.equal(followUpTaskTitle('   '), 'Follow up');
  });
});

describe('creating the follow-up task', () => {
  function recorder() {
    const writes: Record<string, unknown>[] = [];
    const events: Record<string, unknown>[] = [];
    return {
      writes,
      events,
      client: {
        task: {
          create: async (args: { data: Record<string, unknown> }) => {
            writes.push(args.data);
            return { ...args.data, id: 'task_' + writes.length };
          },
        },
        // The task and the event that announces it are written to the same
        // client, in the caller's transaction. A double that only knows about
        // tasks would let the announcement be dropped without a test noticing.
        outboxEvent: {
          create: async (args: { data: Record<string, unknown> }) => {
            events.push(args.data);
            return undefined;
          },
        },
      },
    };
  }

  it('writes a task due when the follow-up was promised', async () => {
    const { writes, client } = recorder();
    const due = new Date('2026-09-01T10:30:00.000Z');

    await createFollowUpTask(client as never, {
      reference: 'TK-2026-000123',
      entityType: 'LEAD',
      entityId: 'lead_1',
      dueAt: due,
      context: 'collect document',
      assigneeId: 'rep_1',
      createdById: 'manager_1',
    });

    assert.equal(writes.length, 1);
    assert.equal(writes[0].reference, 'TK-2026-000123');
    assert.equal(writes[0].title, 'Follow up: collect document');
    assert.equal(writes[0].dueAt, due);
    assert.equal(writes[0].entityType, 'LEAD');
    assert.equal(writes[0].entityId, 'lead_1');
  });

  it('assigns to the owner of the work, not to whoever recorded it', async () => {
    const { writes, client } = recorder();

    await createFollowUpTask(client as never, {
      reference: 'TK-2026-000124',
      entityType: 'LEAD',
      entityId: 'lead_1',
      dueAt: new Date('2026-09-01T10:30:00.000Z'),
      context: 'call back about F&O',
      assigneeId: 'rep_1',
      createdById: 'manager_1',
    });

    // A manager closing out a rep's visit is booking the rep's follow-up. If
    // this ever flips to the actor, follow-ups silently pile onto managers.
    assert.equal(writes[0].assigneeId, 'rep_1');
    assert.equal(writes[0].createdById, 'manager_1');
  });

  it('announces the task so the assignee can be told', async () => {
    const { events, client } = recorder();

    await createFollowUpTask(client as never, {
      reference: 'TK-2026-000125',
      entityType: 'LEAD',
      entityId: 'lead_1',
      dueAt: new Date('2026-09-01T10:30:00.000Z'),
      context: 'send the PMS deck',
      assigneeId: 'rep_1',
      createdById: 'manager_1',
    });

    assert.equal(events.length, 1, 'one task.assigned event');
    assert.equal(events[0].eventType, 'task.assigned');
    assert.equal(events[0].aggregateType, 'task');

    // The router needs both to decide who to tell, and to stay silent when a
    // rep books their own follow-up. Losing either turns the bell into noise
    // or into nothing.
    const payload = events[0].payload as Record<string, unknown>;
    assert.equal(payload.assigneeId, 'rep_1');
    assert.equal(payload.actorId, 'manager_1');
    assert.equal(payload.title, 'Follow up: send the PMS deck');
  });
});
