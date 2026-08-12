import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canGrantRoles,
  canManageUserAt,
  createUserSchema,
  DESIGNATION_SEED,
  employeeCodeSchema,
  scopeForDesignation,
  validateReportingLine,
  type ActorContext,
} from '../src/hierarchy';
import { ROLE_PERMISSIONS } from '../src/rbac';

const LEVELS = Object.fromEntries(DESIGNATION_SEED.map((d) => [d.code, d.level])) as Record<
  string,
  number
>;

/** A Sales Manager in the Ahmedabad branch. */
const salesManager: ActorContext = {
  designationLevel: LEVELS.SALES_MANAGER!,
  orgUnitPath: '/root/west/gujarat/ahmedabad/',
  permissions: [...ROLE_PERMISSIONS.SALES_MANAGER],
  isUnrestricted: false,
};

const admin: ActorContext = {
  designationLevel: null,
  orgUnitPath: null,
  permissions: [...ROLE_PERMISSIONS.SUPER_ADMIN],
  isUnrestricted: true,
};

describe('designation seed', () => {
  it('orders the hierarchy as the business describes it', () => {
    assert.ok(LEVELS.SALES_EXECUTIVE! < LEVELS.SALES_TEAM_LEADER!);
    assert.ok(LEVELS.SALES_TEAM_LEADER! < LEVELS.SALES_MANAGER!);
    assert.ok(LEVELS.SALES_MANAGER! < LEVELS.REGIONAL_HEAD!);
    assert.ok(LEVELS.REGIONAL_HEAD! < LEVELS.ZONAL_HEAD!);
    assert.ok(LEVELS.ZONAL_HEAD! < LEVELS.NATIONAL_HEAD!);
  });

  it('leaves gaps so a level can be inserted without renumbering', () => {
    const levels = DESIGNATION_SEED.map((d) => d.level).sort((a, b) => a - b);
    for (let index = 1; index < levels.length; index += 1) {
      assert.ok(levels[index]! - levels[index - 1]! >= 5, 'gaps must allow insertion');
    }
  });

  it('ships Area Manager inactive, ready but invisible', () => {
    const area = DESIGNATION_SEED.find((d) => d.code === 'AREA_MANAGER');
    assert.equal(area?.isActive, false);
  });

  it('gives every level a sensible default scope', () => {
    const byCode = Object.fromEntries(DESIGNATION_SEED.map((d) => [d.code, d.defaultScope]));
    assert.equal(byCode.SALES_EXECUTIVE, 'SELF');
    assert.equal(byCode.REGIONAL_HEAD, 'REGION');
    assert.equal(byCode.ZONAL_HEAD, 'ZONE');
    assert.equal(byCode.NATIONAL_HEAD, 'ALL');
  });
});

describe('privilege escalation guards', () => {
  it('lets a sales manager create someone junior in their own branch', () => {
    const result = canManageUserAt(salesManager, {
      designationLevel: LEVELS.SALES_EXECUTIVE!,
      orgUnitPath: '/root/west/gujarat/ahmedabad/',
      roleCodes: ['SALES_EXECUTIVE'],
    });
    assert.equal(result.allowed, true);
  });

  it('blocks creating a National Head — the escalation this exists to stop', () => {
    // Without this a sales manager grants themselves company-wide access via a
    // second login, and their own account looks untouched in an audit.
    const result = canManageUserAt(salesManager, {
      designationLevel: LEVELS.NATIONAL_HEAD!,
      orgUnitPath: '/root/west/gujarat/ahmedabad/',
      roleCodes: ['MANAGEMENT'],
    });
    assert.equal(result.allowed, false);
  });

  it('blocks creating a peer at the same level', () => {
    const result = canManageUserAt(salesManager, {
      designationLevel: LEVELS.SALES_MANAGER!,
      orgUnitPath: '/root/west/gujarat/ahmedabad/',
      roleCodes: ['SALES_MANAGER'],
    });
    assert.equal(result.allowed, false);
  });

  it('blocks reaching into another branch', () => {
    const result = canManageUserAt(salesManager, {
      designationLevel: LEVELS.SALES_EXECUTIVE!,
      orgUnitPath: '/root/west/maharashtra/mumbai/',
      roleCodes: ['SALES_EXECUTIVE'],
    });
    assert.equal(result.allowed, false);
  });

  it('allows a branch below their own', () => {
    const result = canManageUserAt(salesManager, {
      designationLevel: LEVELS.SALES_EXECUTIVE!,
      orgUnitPath: '/root/west/gujarat/ahmedabad/satellite/',
      roleCodes: ['SALES_EXECUTIVE'],
    });
    assert.equal(result.allowed, true);
  });

  it('refuses someone with no designation of their own', () => {
    const result = canManageUserAt(
      { ...salesManager, designationLevel: null },
      {
        designationLevel: LEVELS.SALES_EXECUTIVE!,
        orgUnitPath: '/root/west/gujarat/ahmedabad/',
        roleCodes: ['SALES_EXECUTIVE'],
      },
    );
    assert.equal(result.allowed, false);
  });

  it('lets an admin create anyone anywhere', () => {
    const result = canManageUserAt(admin, {
      designationLevel: LEVELS.NATIONAL_HEAD!,
      orgUnitPath: '/root/',
      roleCodes: ['MANAGEMENT'],
    });
    assert.equal(result.allowed, true);
  });
});

describe('role granting', () => {
  it('lets a sales manager grant a role weaker than their own', () => {
    const result = canGrantRoles(
      ROLE_PERMISSIONS.SALES_MANAGER,
      ROLE_PERMISSIONS,
      ['SALES_EXECUTIVE'],
      false,
    );
    assert.equal(result.allowed, true);
  });

  it('blocks granting a role carrying permissions they lack', () => {
    // Otherwise the level and org-unit guards are bypassed by creating a
    // junior who holds authority the creator does not.
    const result = canGrantRoles(
      ROLE_PERMISSIONS.SALES_MANAGER,
      ROLE_PERMISSIONS,
      ['SUPER_ADMIN'],
      false,
    );
    assert.equal(result.allowed, false);
    if (!result.allowed) assert.match(result.reason, /permissions you do not hold/);
  });

  it('blocks granting audit access they do not have', () => {
    const result = canGrantRoles(
      ROLE_PERMISSIONS.SALES_MANAGER,
      ROLE_PERMISSIONS,
      ['MANAGEMENT'],
      false,
    );
    assert.equal(result.allowed, false);
  });

  it('lets an admin grant anything', () => {
    const result = canGrantRoles([], ROLE_PERMISSIONS, ['SUPER_ADMIN'], true);
    assert.equal(result.allowed, true);
  });
});

describe('reporting lines', () => {
  it('accepts a junior reporting to a senior', () => {
    const result = validateReportingLine(LEVELS.SALES_EXECUTIVE!, LEVELS.SALES_MANAGER!);
    assert.equal(result.allowed, true);
  });

  it('permits skipped levels — Regional and Zonal are optional', () => {
    // A Sales Manager reporting straight to a Zonal Head where no Regional Head
    // exists. This is the requirement that makes designations data, not code.
    const result = validateReportingLine(LEVELS.SALES_MANAGER!, LEVELS.ZONAL_HEAD!);
    assert.equal(result.allowed, true);
  });

  it('rejects reporting to a peer', () => {
    const result = validateReportingLine(LEVELS.SALES_MANAGER!, LEVELS.SALES_MANAGER!);
    assert.equal(result.allowed, false);
  });

  it('rejects an inverted reporting line', () => {
    const result = validateReportingLine(LEVELS.ZONAL_HEAD!, LEVELS.SALES_EXECUTIVE!);
    assert.equal(result.allowed, false);
  });

  it('accepts no manager at all — someone has to be at the top', () => {
    assert.equal(validateReportingLine(LEVELS.NATIONAL_HEAD!, null).allowed, true);
  });
});

describe('scope from designation', () => {
  it('uses the designation default when nothing is overridden', () => {
    assert.equal(scopeForDesignation('ZONE'), 'ZONE');
  });

  it('allows narrowing — a new Zonal Head limited to one region', () => {
    assert.equal(scopeForDesignation('ZONE', 'REGION'), 'REGION');
  });

  it('silently ignores an attempt to widen', () => {
    // Degrading to less access on a mis-keyed edit is the safe failure.
    assert.equal(scopeForDesignation('BRANCH', 'ALL'), 'BRANCH');
    assert.equal(scopeForDesignation('SELF', 'ZONE'), 'SELF');
  });
});

describe('user and employee code validation', () => {
  const valid = {
    firstName: 'Asha',
    lastName: 'Patel',
    email: 'asha.patel@sihl.in',
    designationId: 'desig-1234',
    roleCodes: ['SALES_EXECUTIVE' as const],
    orgUnitId: 'orgunit-1234',
  };

  it('accepts a minimal internal user', () => {
    assert.ok(createUserSchema.safeParse(valid).success);
  });

  it('requires at least one role', () => {
    assert.equal(createUserSchema.safeParse({ ...valid, roleCodes: [] }).success, false);
  });

  it('accepts the employee-code formats HR systems actually use', () => {
    assert.equal(employeeCodeSchema.parse('sihl-0421'), 'SIHL-0421');
    assert.ok(employeeCodeSchema.safeParse('EMP/2026/018').success);
    assert.ok(employeeCodeSchema.safeParse('10482').success);
  });

  it('rejects an employee code with spaces or symbols', () => {
    assert.equal(employeeCodeSchema.safeParse('EMP 421').success, false);
    assert.equal(employeeCodeSchema.safeParse('EMP#421').success, false);
  });

  it('treats the employee code as optional until HR is connected', () => {
    assert.ok(createUserSchema.safeParse(valid).success);
    assert.ok(createUserSchema.safeParse({ ...valid, employeeCode: 'SIHL-0421' }).success);
  });
});
