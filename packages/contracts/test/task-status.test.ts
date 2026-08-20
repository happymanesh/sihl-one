import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { canDeactivateTaskStatus, type TaskStatusItem } from '../src/masters';

type Row = Pick<TaskStatusItem, 'code' | 'category' | 'isActive'>;

const rows = (...items: Array<[string, TaskStatusItem['category'], boolean]>): Row[] =>
  items.map(([code, category, isActive]) => ({ code, category, isActive }));

describe('canDeactivateTaskStatus', () => {
  it('refuses to empty a category', () => {
    const all = rows(['OPEN', 'OPEN', true], ['DONE', 'DONE', true]);
    const result = canDeactivateTaskStatus(all[0]!, all);

    assert.equal(result.allowed, false);
    assert.match(result.reason ?? '', /nowhere to go/);
  });

  it('allows it while a sibling stays active', () => {
    const all = rows(
      ['OPEN', 'OPEN', true],
      ['AWAITING_DOCS', 'OPEN', true],
      ['DONE', 'DONE', true],
    );

    assert.equal(canDeactivateTaskStatus(all[0]!, all).allowed, true);
  });

  it('does not count inactive siblings as a way out', () => {
    const all = rows(['OPEN', 'OPEN', true], ['AWAITING_DOCS', 'OPEN', false]);

    assert.equal(canDeactivateTaskStatus(all[0]!, all).allowed, false);
  });

  it('is a no-op for a status that is already inactive', () => {
    const all = rows(['OPEN', 'OPEN', false]);

    assert.equal(canDeactivateTaskStatus(all[0]!, all).allowed, true);
  });

  it('only considers siblings in the same category', () => {
    // A DONE status does not rescue an empty OPEN category.
    const all = rows(['OPEN', 'OPEN', true], ['DONE', 'DONE', true], ['CLOSED', 'DONE', true]);

    assert.equal(canDeactivateTaskStatus(all[0]!, all).allowed, false);
  });
});
