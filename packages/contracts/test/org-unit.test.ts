import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildPath,
  canDeleteOrgUnit,
  canParent,
  createOrgUnitSchema,
  depthOf,
  explainParentRule,
  moveOrgUnitSchema,
  pathIds,
  toTreeOrder,
  wouldCreateCycle,
  type OrgUnitNode,
} from '../src/org-unit';

const node = (over: Partial<OrgUnitNode> & { id: string }): OrgUnitNode => ({
  code: over.id.toUpperCase(),
  name: over.id,
  type: 'BRANCH',
  parentId: null,
  path: `/${over.id}/`,
  isActive: true,
  depth: 0,
  userCount: 0,
  leadCount: 0,
  childCount: 0,
  ...over,
});

describe('who may sit under whom', () => {
  it('allows the chain SIHL actually uses', () => {
    assert.ok(canParent('ZONE', 'COMPANY'));
    assert.ok(canParent('REGION', 'ZONE'));
    assert.ok(canParent('BRANCH', 'REGION'));
    assert.ok(canParent('TEAM', 'BRANCH'));
  });

  it('lets the middle levels be skipped', () => {
    // Not every zone has regions, and a smaller business should not be made to
    // invent them just to open a branch.
    assert.ok(canParent('BRANCH', 'ZONE'));
    assert.ok(canParent('BRANCH', 'COMPANY'));
    assert.ok(canParent('REGION', 'COMPANY'));
  });

  it('refuses inversions', () => {
    assert.equal(canParent('ZONE', 'BRANCH'), false);
    assert.equal(canParent('REGION', 'BRANCH'), false);
    assert.equal(canParent('BRANCH', 'TEAM'), false);
  });

  it('never lets a company be placed under anything', () => {
    for (const parent of ['ZONE', 'REGION', 'BRANCH', 'TEAM'] as const) {
      assert.equal(canParent('COMPANY', parent), false, parent);
    }
  });

  it('explains a refusal in terms an administrator can act on', () => {
    const message = explainParentRule('ZONE', 'BRANCH');
    assert.match(message, /zone/i);
    assert.match(message, /company/i);
    assert.ok(message.endsWith('.'));
  });
});

describe('paths', () => {
  it('builds from ids so a rename never touches them', () => {
    assert.equal(buildPath(null, 'root'), '/root/');
    assert.equal(buildPath('/root/', 'zone'), '/root/zone/');
    assert.equal(buildPath('/root/zone/', 'branch'), '/root/zone/branch/');
  });

  it('reads back the ancestry, root first', () => {
    assert.deepEqual(pathIds('/root/zone/branch/'), ['root', 'zone', 'branch']);
  });

  it('measures depth from the root', () => {
    assert.equal(depthOf('/root/'), 0);
    assert.equal(depthOf('/root/zone/branch/'), 2);
  });

  it('prefix-matches only whole segments', () => {
    // The trailing slash is what stops `/root/ab/` matching `/root/abc/` — the
    // bug that would leak one branch's book into another's.
    assert.equal('/root/abc/'.startsWith('/root/ab/'), false);
  });
});

describe('cycles', () => {
  it('refuses to move a unit inside its own subtree', () => {
    assert.equal(wouldCreateCycle('/root/zone/', '/root/zone/branch/'), true);
  });

  it('refuses to move a unit under itself', () => {
    assert.equal(wouldCreateCycle('/root/zone/', '/root/zone/'), true);
  });

  it('allows a genuine move sideways', () => {
    assert.equal(wouldCreateCycle('/root/z1/branch/', '/root/z2/'), false);
  });
});

describe('deleting', () => {
  it('refuses a unit with children, people or leads', () => {
    assert.equal(canDeleteOrgUnit({ childCount: 1, userCount: 0, leadCount: 0 }).ok, false);
    assert.equal(canDeleteOrgUnit({ childCount: 0, userCount: 2, leadCount: 0 }).ok, false);
    assert.equal(canDeleteOrgUnit({ childCount: 0, userCount: 0, leadCount: 9 }).ok, false);
  });

  it('allows an empty unit created by mistake', () => {
    assert.equal(canDeleteOrgUnit({ childCount: 0, userCount: 0, leadCount: 0 }).ok, true);
  });

  it('always says what to do instead', () => {
    const reason = canDeleteOrgUnit({ childCount: 0, userCount: 0, leadCount: 9 }).reason ?? '';
    assert.match(reason, /switch it off/i);
  });
});

describe('tree order', () => {
  it('puts each parent immediately before its children', () => {
    const nodes = [
      node({ id: 'branch', type: 'BRANCH', parentId: 'zone', path: '/root/zone/branch/' }),
      node({ id: 'root', type: 'COMPANY', parentId: null, path: '/root/' }),
      node({ id: 'zone', type: 'ZONE', parentId: 'root', path: '/root/zone/' }),
    ];
    assert.deepEqual(
      toTreeOrder(nodes).map((entry) => entry.id),
      ['root', 'zone', 'branch'],
    );
  });

  it('orders siblings by type then name, not by id', () => {
    const nodes = [
      node({ id: 'root', type: 'COMPANY', parentId: null, path: '/root/' }),
      node({ id: 'b', name: 'Zulu branch', type: 'BRANCH', parentId: 'root', path: '/root/b/' }),
      node({ id: 'a', name: 'Alpha branch', type: 'BRANCH', parentId: 'root', path: '/root/a/' }),
      node({ id: 'z', name: 'West zone', type: 'ZONE', parentId: 'root', path: '/root/z/' }),
    ];
    assert.deepEqual(
      toTreeOrder(nodes).map((entry) => entry.name),
      ['root', 'West zone', 'Alpha branch', 'Zulu branch'],
    );
  });

  it('surfaces an orphan rather than dropping it', () => {
    // A tree with an unreachable node is a bug worth seeing on screen.
    const nodes = [
      node({ id: 'root', type: 'COMPANY', parentId: null, path: '/root/' }),
      node({ id: 'lost', parentId: 'gone', path: '/gone/lost/' }),
    ];
    assert.equal(toTreeOrder(nodes).length, 2);
  });
});

describe('input', () => {
  it('requires a reason to move a unit', () => {
    // A move silently changes who can see whose customers.
    assert.equal(moveOrgUnitSchema.safeParse({ parentId: 'unit-1234abcd' }).success, false);
    assert.ok(
      moveOrgUnitSchema.safeParse({ parentId: 'unit-1234abcd', reason: 'Branch reorganised' })
        .success,
    );
  });

  it('accepts a root with no parent', () => {
    assert.ok(createOrgUnitSchema.safeParse({ code: 'SIHL', name: 'SIHL', type: 'COMPANY' }).success);
  });

  it('rejects a code that would not survive a URL or a report', () => {
    for (const code of ['ahm ho', 'ahm/ho', '']) {
      assert.equal(
        createOrgUnitSchema.safeParse({ code, name: 'Branch', type: 'BRANCH' }).success,
        false,
        code,
      );
    }
  });
});
