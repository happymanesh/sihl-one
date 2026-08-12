/**
 * Creates the real SIHL ONE users on a fresh production database.
 *
 * The alternative is clicking seven people into `/admin/users` and getting the
 * reporting lines right by hand — and the reporting lines are not cosmetic here.
 * A sales manager's `TEAM` scope resolves to *their own direct reports*, so a
 * manager whose executives were not linked to them sees nothing, and one linked
 * to the wrong executives sees the wrong book. This does it deterministically.
 *
 * Edit TEAM below with real names, emails and mobiles, then:
 *
 *   npx tsx prisma/bootstrap-team.ts            # report what it would create
 *   npx tsx prisma/bootstrap-team.ts --apply    # create them, print passwords
 *
 * Safe to re-run: anyone whose email already exists is left untouched.
 */
import 'dotenv/config';
import { randomInt } from 'node:crypto';

import { hash, Algorithm } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client';

// ===========================================================================
// EDIT THIS
// ===========================================================================

/** The org unit everyone sits in. Must already exist — see `orgUnitCode`. */
const ORG_UNIT_CODE = 'AHM-HO';

interface Person {
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  employeeCode: string;
  /** Blank for the managers and the admin. */
  reportsTo?: string;
}

const ADMIN: Person = {
  firstName: 'Manesh',
  lastName: 'Mukherjee',
  email: 'manesh@sihl.in',
  mobile: '9000091001',
  employeeCode: 'SIHL-1001',
};

const MANAGERS: Person[] = [
  {
    firstName: 'B2C',
    lastName: 'Manager',
    email: 'b2c.manager@sihl.in',
    mobile: '9000091002',
    employeeCode: 'SIHL-1002',
  },
  {
    firstName: 'B2B',
    lastName: 'Manager',
    email: 'b2b.manager@sihl.in',
    mobile: '9000091003',
    employeeCode: 'SIHL-1003',
  },
];

const EXECUTIVES: Person[] = [
  {
    firstName: 'B2C',
    lastName: 'Executive One',
    email: 'b2c.one@sihl.in',
    mobile: '9000091004',
    employeeCode: 'SIHL-1004',
    reportsTo: 'b2c.manager@sihl.in',
  },
  {
    firstName: 'B2C',
    lastName: 'Executive Two',
    email: 'b2c.two@sihl.in',
    mobile: '9000091005',
    employeeCode: 'SIHL-1005',
    reportsTo: 'b2c.manager@sihl.in',
  },
  {
    firstName: 'B2B',
    lastName: 'Executive One',
    email: 'b2b.one@sihl.in',
    mobile: '9000091006',
    employeeCode: 'SIHL-1006',
    reportsTo: 'b2b.manager@sihl.in',
  },
  {
    firstName: 'B2B',
    lastName: 'Executive Two',
    email: 'b2b.two@sihl.in',
    mobile: '9000091007',
    employeeCode: 'SIHL-1007',
    reportsTo: 'b2b.manager@sihl.in',
  },
];

// ===========================================================================

const APPLY = process.argv.includes('--apply');
const PEPPER = process.env.PASSWORD_PEPPER ?? '';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const ARGON = { algorithm: Algorithm.Argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

/**
 * A temporary password the recipient will be asked to change.
 *
 * Ambiguous characters are left out for the same reason as the recovery codes:
 * these get read down a phone line on the first day, and a rejected sign-in
 * that was actually a misheard character wastes an afternoon.
 */
function temporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let password = '';
  for (let index = 0; index < 16; index += 1) {
    password += alphabet[randomInt(alphabet.length)];
  }
  // The policy needs a symbol and a digit; the alphabet above guarantees the
  // digit only probabilistically, so both are appended rather than hoped for.
  return `${password}7#`;
}

async function main(): Promise<void> {
  if (!PEPPER) {
    throw new Error('PASSWORD_PEPPER is not set. Hashes written without it will not verify.');
  }

  const orgUnit = await prisma.orgUnit.findUnique({ where: { code: ORG_UNIT_CODE } });
  if (!orgUnit) {
    throw new Error(
      `Org unit "${ORG_UNIT_CODE}" does not exist. Run the seed first (it creates the ` +
        `hierarchy even in production), or create it in /admin/org-units.`,
    );
  }

  const designations = new Map(
    (await prisma.designation.findMany({ select: { code: true, id: true } })).map((row) => [
      row.code,
      row.id,
    ]),
  );

  const plan: Array<{ person: Person; role: string; scope: string; designation: string }> = [
    { person: ADMIN, role: 'SUPER_ADMIN', scope: 'ALL', designation: 'NATIONAL_HEAD' },
    ...MANAGERS.map((person) => ({
      person,
      role: 'SALES_MANAGER',
      // TEAM, not BRANCH: two managers in one branch must not see each other's
      // book, and TEAM resolves to their own direct reports.
      scope: 'TEAM',
      designation: 'SALES_MANAGER',
    })),
    ...EXECUTIVES.map((person) => ({
      person,
      role: 'SALES_EXECUTIVE',
      scope: 'SELF',
      designation: 'SALES_EXECUTIVE',
    })),
  ];

  const existing = new Set(
    (
      await prisma.user.findMany({
        where: { email: { in: plan.map((entry) => entry.person.email) } },
        select: { email: true },
      })
    ).map((row) => row.email),
  );

  // Checked up front, and named. The raw constraint error names the column but
  // not the row, which leaves whoever ran this guessing which of seven people
  // clashed — on a database that is now half-populated.
  const clashes = await prisma.user.findMany({
    where: { employeeCode: { in: plan.map((entry) => entry.person.employeeCode) } },
    select: { employeeCode: true, email: true },
  });
  const blocking = clashes.filter(
    (row) => !plan.some((entry) => entry.person.email === row.email),
  );
  if (blocking.length > 0) {
    const lines = [
      'These employee codes already belong to somebody else:',
      ...blocking.map((row) => `  ${row.employeeCode} — ${row.email}`),
      '',
      'Edit the TEAM block above. On a fresh production database this will not happen;',
      'locally the demo seed holds SIHL-0001 upward.',
    ];
    throw new Error(lines.join('\n'));
  }

  console.log(`Org unit      : ${orgUnit.name} (${orgUnit.code})`);
  console.log(`To create     : ${plan.filter((e) => !existing.has(e.person.email)).length}`);
  console.log(`Already exist : ${existing.size}\n`);

  for (const entry of plan) {
    const mark = existing.has(entry.person.email) ? 'skip' : 'new ';
    console.log(
      `  ${mark}  ${entry.person.email.padEnd(24)} ${entry.role.padEnd(16)} scope=${entry.scope.padEnd(5)}` +
        `${entry.person.reportsTo ? ` reports to ${entry.person.reportsTo}` : ''}`,
    );
  }

  if (!APPLY) {
    console.log('\nReport only. Re-run with --apply to create them.');
    return;
  }

  const credentials: Array<{ email: string; password: string }> = [];

  // Managers before executives, so a report's manager id already exists.
  for (const entry of plan) {
    if (existing.has(entry.person.email)) continue;

    const password = temporaryPassword();
    const manager = entry.person.reportsTo
      ? await prisma.user.findUnique({ where: { email: entry.person.reportsTo } })
      : null;

    if (entry.person.reportsTo && !manager) {
      throw new Error(
        `${entry.person.email} reports to ${entry.person.reportsTo}, which does not exist. ` +
          `Check the email in the TEAM block above.`,
      );
    }

    const user = await prisma.user.create({
      data: {
        // Same shape the seed uses, and unique because the mobiles are.
        reference: `US-${entry.person.mobile.slice(-6)}`,
        firstName: entry.person.firstName,
        lastName: entry.person.lastName,
        email: entry.person.email,
        mobile: entry.person.mobile,
        employeeCode: entry.person.employeeCode,
        passwordHash: await hash(`${password}${PEPPER}`, ARGON),
        userType: 'INTERNAL',
        status: 'ACTIVE',
        dataScope: entry.scope as never,
        orgUnitId: orgUnit.id,
        managerId: manager?.id ?? null,
        designationId: designations.get(entry.designation) ?? null,
        // Forces a change on first sign-in, so the password read out over the
        // phone stops working the moment they are in.
        mustChangePassword: true,
      },
    });

    await prisma.userRole.create({ data: { userId: user.id, roleCode: entry.role as never } });
    credentials.push({ email: entry.person.email, password });
  }

  console.log('\n─── Temporary passwords — shown once ───');
  for (const entry of credentials) {
    console.log(`  ${entry.email.padEnd(26)} ${entry.password}`);
  }
  console.log(
    '\nEach person must change this at first sign-in. Hand them over individually, not in ' +
      'a group chat.',
  );
}

main()
  .catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
