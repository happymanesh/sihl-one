/**
 * Seed data for SIHL ONE.
 *
 * Two jobs, deliberately separated below:
 *
 *  1. **Reference data** (org hierarchy, roles) — required for the application
 *     to function at all, in every environment including production. Written
 *     idempotently with upserts so re-running is safe.
 *  2. **Demo data** (users, leads, customers, activities) — only for local and
 *     UAT. Guarded so it cannot run against production, because seeding fake
 *     leads into a live CRM is not a recoverable mistake.
 *
 * Names, cities and product mixes are chosen to look like SIHL's actual book
 * (Gujarat-weighted, equity and derivatives heavy) so that screens are being
 * judged against plausible data rather than "Test User 1".
 */
import 'dotenv/config';
import { hash, Algorithm } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  DESIGNATION_SEED,
  ROLE_PERMISSIONS,
  ROLES,
  scoreLead,
  type ScoringFeatures,
} from '@sihl-one/contracts';

import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'Sihl@One2026!';
const PEPPER = process.env.PASSWORD_PEPPER ?? 'dev-only-pepper-change-me';

const ARGON_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

function hashPassword(plain: string): Promise<string> {
  return hash(`${plain}${PEPPER}`, ARGON_OPTIONS);
}

const DAY = 86_400_000;
const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY);
const daysAhead = (days: number): Date => new Date(Date.now() + days * DAY);

/** Deterministic pseudo-random so re-seeding produces the same demo book. */
let seedState = 20260809;
function random(): number {
  seedState = (seedState * 1664525 + 1013904223) % 4294967296;
  return seedState / 4294967296;
}
function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}
function pickMany<T>(items: readonly T[], max: number): T[] {
  const count = 1 + Math.floor(random() * max);
  const shuffled = [...items].sort(() => random() - 0.5);
  return shuffled.slice(0, count);
}

// ---------------------------------------------------------------------------

async function seedRoles(): Promise<void> {
  const descriptions: Record<string, { name: string; description: string }> = {
    SUPER_ADMIN: { name: 'Super Administrator', description: 'Unrestricted access. Break-glass account.' },
    MANAGEMENT: { name: 'Management', description: 'Read-only visibility across the business, plus analytics.' },
    OPERATIONS: { name: 'Operations', description: 'Onboarding, servicing and data quality.' },
    MARKETING: { name: 'Marketing', description: 'Campaigns, lead sources and attribution.' },
    SALES_MANAGER: { name: 'Sales Manager', description: 'Owns a team; assigns and reviews their pipeline.' },
    SALES_EXECUTIVE: { name: 'Sales Executive', description: 'Field and desk sales. Own leads only.' },
    PARTNER: { name: 'Associate Partner', description: 'External partner. Own sourced business only.' },
    CUSTOMER: { name: 'Customer', description: 'End customer self-service.' },
  };

  for (const code of ROLES) {
    const meta = descriptions[code]!;
    await prisma.role.upsert({
      where: { code },
      // Permissions are re-synced from the contracts matrix on every run so a
      // code change to the matrix reaches every environment through the normal
      // deploy, rather than needing a manual SQL fix.
      update: { permissions: [...ROLE_PERMISSIONS[code]], name: meta.name, description: meta.description },
      create: {
        code,
        name: meta.name,
        description: meta.description,
        permissions: [...ROLE_PERMISSIONS[code]],
        isSystem: true,
      },
    });
  }
  console.log(`  roles: ${ROLES.length}`);
}

async function seedDesignations(): Promise<Map<string, string>> {
  const byCode = new Map<string, string>();

  for (const designation of DESIGNATION_SEED) {
    const row = await prisma.designation.upsert({
      where: { code: designation.code },
      // Name, level and scope re-sync from code on every run. `isActive` is
      // deliberately left alone so an operator switching Area Manager on is not
      // silently undone by the next deploy.
      update: {
        name: designation.name,
        level: designation.level,
        defaultScope: designation.defaultScope,
      },
      create: { ...designation, isSystem: true },
    });
    byCode.set(designation.code, row.id);
  }

  console.log(`  designations: ${byCode.size}`);
  return byCode;
}

interface OrgSeed {
  code: string;
  name: string;
  type: 'COMPANY' | 'ZONE' | 'REGION' | 'BRANCH' | 'TEAM';
  parent?: string;
}

async function seedOrgUnits(): Promise<Map<string, { id: string; path: string }>> {
  const units: OrgSeed[] = [
    { code: 'SIHL', name: 'Shah Investors Home Ltd.', type: 'COMPANY' },
    { code: 'WEST', name: 'West Zone', type: 'ZONE', parent: 'SIHL' },
    { code: 'GUJ', name: 'Gujarat Region', type: 'REGION', parent: 'WEST' },
    { code: 'MAH', name: 'Maharashtra Region', type: 'REGION', parent: 'WEST' },
    { code: 'AHM-HO', name: 'Ahmedabad Head Office', type: 'BRANCH', parent: 'GUJ' },
    { code: 'AHM-SAT', name: 'Ahmedabad — Satellite', type: 'BRANCH', parent: 'GUJ' },
    { code: 'SUR', name: 'Surat Branch', type: 'BRANCH', parent: 'GUJ' },
    { code: 'VAD', name: 'Vadodara Branch', type: 'BRANCH', parent: 'GUJ' },
    { code: 'MUM', name: 'Mumbai Branch', type: 'BRANCH', parent: 'MAH' },
  ];

  const created = new Map<string, { id: string; path: string }>();

  for (const unit of units) {
    const parent = unit.parent ? created.get(unit.parent) : undefined;
    const existing = await prisma.orgUnit.findUnique({ where: { code: unit.code } });

    if (existing) {
      created.set(unit.code, { id: existing.id, path: existing.path });
      continue;
    }

    // Path is written in two steps because it embeds the row's own id, which
    // Prisma only knows after the insert. Cheap, and it makes every subtree
    // query a single indexed prefix match forever after.
    const row = await prisma.orgUnit.create({
      data: {
        code: unit.code,
        name: unit.name,
        type: unit.type,
        parentId: parent?.id ?? null,
        path: '',
      },
    });
    const path = `${parent?.path ?? '/'}${row.id}/`;
    await prisma.orgUnit.update({ where: { id: row.id }, data: { path } });
    created.set(unit.code, { id: row.id, path });
  }

  console.log(`  org units: ${created.size}`);
  return created;
}

interface UserSeed {
  firstName: string;
  lastName: string;
  email: string;
  mobile: string;
  role: (typeof ROLES)[number];
  orgUnit: string;
  managerEmail?: string;
  dataScope?: 'ALL' | 'ZONE' | 'REGION' | 'BRANCH' | 'TEAM' | 'SELF';
  designation?: string;
  employeeCode?: string;
}

async function seedUsers(
  orgUnits: Map<string, { id: string; path: string }>,
  designations: Map<string, string>,
) {
  const passwordHash = await hashPassword(SEED_PASSWORD);

  const people: UserSeed[] = [
    { firstName: 'Manesh', lastName: 'Mukherjee', email: 'admin@sihl.in', mobile: '9000090001', role: 'SUPER_ADMIN', orgUnit: 'SIHL', employeeCode: 'SIHL-0001' },
    { firstName: 'Tanmay', lastName: 'Shah', email: 'md@sihl.in', mobile: '9000090002', role: 'MANAGEMENT', orgUnit: 'SIHL', designation: 'NATIONAL_HEAD', employeeCode: 'SIHL-0002' },
    { firstName: 'Rekha', lastName: 'Iyer', email: 'ops@sihl.in', mobile: '9000090003', role: 'OPERATIONS', orgUnit: 'AHM-HO', employeeCode: 'SIHL-0003' },
    { firstName: 'Nikhil', lastName: 'Bhatt', email: 'marketing@sihl.in', mobile: '9000090004', role: 'MARKETING', orgUnit: 'AHM-HO', employeeCode: 'SIHL-0004' },
    // A Zonal Head with no Regional Head beneath them, reporting nowhere. This
    // is the skipped level the hierarchy exists to support.
    { firstName: 'Kiran', lastName: 'Shah', email: 'zonalhead@sihl.in', mobile: '9000090010', role: 'SALES_MANAGER', orgUnit: 'WEST', designation: 'ZONAL_HEAD', dataScope: 'ZONE', employeeCode: 'SIHL-0010' },
    { firstName: 'Priya', lastName: 'Desai', email: 'salesmanager@sihl.in', mobile: '9000090005', role: 'SALES_MANAGER', orgUnit: 'AHM-HO', designation: 'SALES_MANAGER', managerEmail: 'zonalhead@sihl.in', employeeCode: 'SIHL-0005' },
    { firstName: 'Rahul', lastName: 'Mehta', email: 'rahul.mehta@sihl.in', mobile: '9000090006', role: 'SALES_EXECUTIVE', orgUnit: 'AHM-HO', designation: 'SALES_EXECUTIVE', managerEmail: 'salesmanager@sihl.in', employeeCode: 'SIHL-0006' },
    { firstName: 'Sneha', lastName: 'Patel', email: 'sneha.patel@sihl.in', mobile: '9000090007', role: 'SALES_EXECUTIVE', orgUnit: 'AHM-SAT', designation: 'SALES_EXECUTIVE', managerEmail: 'salesmanager@sihl.in', employeeCode: 'SIHL-0007' },
    { firstName: 'Vikram', lastName: 'Joshi', email: 'vikram.joshi@sihl.in', mobile: '9000090008', role: 'SALES_EXECUTIVE', orgUnit: 'SUR', designation: 'SALES_EXECUTIVE', managerEmail: 'salesmanager@sihl.in', employeeCode: 'SIHL-0008' },
    { firstName: 'Anita', lastName: 'Raval', email: 'anita.raval@sihl.in', mobile: '9000090009', role: 'SALES_EXECUTIVE', orgUnit: 'VAD', designation: 'SALES_TEAM_LEADER', managerEmail: 'salesmanager@sihl.in', employeeCode: 'SIHL-0009' },
  ];

  const byEmail = new Map<string, { id: string; orgUnitId: string | null }>();

  for (const person of people) {
    const org = orgUnits.get(person.orgUnit)!;
    const reference = `US-${person.mobile.slice(-6)}`;

    const user = await prisma.user.upsert({
      where: { email: person.email },
      // Designation and employee code re-sync on every run, the same way role
      // permissions do. Without this an existing demo book never picks up a
      // newly introduced hierarchy and every level reports zero users.
      update: {
        designationId: person.designation ? (designations.get(person.designation) ?? null) : null,
        employeeCode: person.employeeCode ?? null,
        // The password re-syncs too. Without this, SEED_PASSWORD only takes
        // effect on a database that has never been seeded — so a demo password
        // that has leaked cannot be rotated by re-running the seed, which is
        // exactly the moment someone reaches for it.
        passwordHash,
        passwordChangedAt: new Date(),
      },
      create: {
        reference,
        firstName: person.firstName,
        lastName: person.lastName,
        email: person.email,
        mobile: person.mobile,
        passwordHash,
        userType: 'INTERNAL',
        status: 'ACTIVE',
        dataScope: person.dataScope ?? null,
        orgUnitId: org.id,
        designationId: person.designation ? (designations.get(person.designation) ?? null) : null,
        employeeCode: person.employeeCode ?? null,
        passwordChangedAt: new Date(),
      },
    });

    await prisma.userRole.upsert({
      where: { userId_roleCode: { userId: user.id, roleCode: person.role } },
      update: {},
      create: { userId: user.id, roleCode: person.role },
    });

    byEmail.set(person.email, { id: user.id, orgUnitId: user.orgUnitId });
  }

  // Reporting lines, applied after everyone exists.
  for (const person of people.filter((entry) => entry.managerEmail)) {
    const user = byEmail.get(person.email)!;
    const manager = byEmail.get(person.managerEmail!)!;
    await prisma.user.update({ where: { id: user.id }, data: { managerId: manager.id } });
  }

  console.log(`  users: ${people.length}`);
  return byEmail;
}

/**
 * Quarterly targets for the sales team.
 *
 * Seeded so the scorecard shows pacing rather than an empty panel. The values
 * are deliberately modest against the seeded pipeline — a demo where everyone
 * is at 300% of target teaches nobody how the screen reads.
 */
/**
 * One event per lifecycle state, so the QR screen has something to show and the
 * "scans are not open yet" path is visible without anybody editing data first.
 */
async function seedEvents(
  users: Map<string, { id: string }>,
  campaigns: Array<{ id: string; code: string }>,
) {
  const owner = users.get('salesmanager@sihl.in');

  const events = [
    {
      reference: 'EV-2026-000901',
      name: 'Ahmedabad Investor Expo',
      code: 'ahmedabad-expo',
      status: 'RUNNING' as const,
      venue: 'Gujarat University Convention Centre',
      city: 'Ahmedabad',
      startsAt: daysAgo(1),
      endsAt: daysAhead(1),
      expectedFootfall: 800,
    },
    {
      reference: 'EV-2026-000902',
      name: 'Surat Derivatives Workshop',
      code: 'surat-derivatives',
      status: 'PLANNED' as const,
      venue: 'Hotel Lords Plaza',
      city: 'Surat',
      startsAt: daysAhead(21),
      expectedFootfall: 120,
    },
  ];

  for (const event of events) {
    await prisma.event.upsert({
      where: { code: event.code },
      update: { status: event.status },
      create: {
        ...event,
        endsAt: event.endsAt ?? null,
        ownerId: owner?.id ?? null,
        campaignId: campaigns.find((c) => c.code === 'FNO-MASTERY-Q3')?.id ?? null,
      },
    });
  }

  console.log('  events: %d', events.length);
}

async function seedTargets(users: Map<string, { id: string }>) {
  const now = new Date();
  const quarterStart = new Date(
    Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1),
  );

  const targets: Array<{ email: string; conversions: number; value: number }> = [
    { email: 'salesmanager@sihl.in', conversions: 40, value: 20_000_000 },
    { email: 'rahul.mehta@sihl.in', conversions: 12, value: 6_000_000 },
    { email: 'sneha.patel@sihl.in', conversions: 12, value: 6_000_000 },
    { email: 'vikram.joshi@sihl.in', conversions: 10, value: 5_000_000 },
    { email: 'anita.raval@sihl.in', conversions: 14, value: 7_000_000 },
  ];

  let count = 0;
  for (const target of targets) {
    const user = users.get(target.email);
    if (!user) continue;

    await prisma.salesTarget.upsert({
      where: {
        userId_period_periodStart: {
          userId: user.id,
          period: 'QUARTER',
          periodStart: quarterStart,
        },
      },
      update: { conversionTarget: target.conversions, valueTarget: target.value },
      create: {
        userId: user.id,
        period: 'QUARTER',
        periodStart: quarterStart,
        conversionTarget: target.conversions,
        valueTarget: target.value,
      },
    });
    count += 1;
  }

  console.log('  %d quarterly targets', count);
}

async function seedPartner(orgUnits: Map<string, { id: string; path: string }>) {
  const partner = await prisma.partner.upsert({
    where: { reference: 'PT-2026-000001' },
    update: {},
    create: {
      reference: 'PT-2026-000001',
      name: 'Trinetra Financial Services',
      type: 'AUTHORISED_PERSON',
      status: 'ACTIVE',
      contactPerson: 'Jignesh Trivedi',
      email: 'jignesh@trinetrafin.in',
      mobile: '9000099999',
      gstin: '24AABCT1234A1Z5',
      sebiRegNo: 'AP0198765432',
      city: 'Ahmedabad',
      state: 'Gujarat',
      pincode: '380015',
      commissionRate: 35.0,
      orgUnitId: orgUnits.get('AHM-HO')!.id,
      onboardedAt: daysAgo(400),
    },
  });

  const passwordHash = await hashPassword(SEED_PASSWORD);
  const partnerUser = await prisma.user.upsert({
    where: { email: 'partner@trinetrafin.in' },
    update: {},
    create: {
      reference: 'US-011122',
      firstName: 'Jignesh',
      lastName: 'Trivedi',
      email: 'partner@trinetrafin.in',
      mobile: '9000099999',
      passwordHash,
      userType: 'PARTNER',
      status: 'ACTIVE',
      partnerId: partner.id,
      orgUnitId: orgUnits.get('AHM-HO')!.id,
      passwordChangedAt: new Date(),
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleCode: { userId: partnerUser.id, roleCode: 'PARTNER' } },
    update: {},
    create: { userId: partnerUser.id, roleCode: 'PARTNER' },
  });

  console.log('  partners: 1 (with portal login)');
  return partner;
}

async function seedCampaigns() {
  const campaigns = [
    {
      reference: 'CM-2026-000001',
      code: 'FNO-MASTERY-Q3',
      name: 'F&O Mastery — Q3 Webinar Funnel',
      channels: ['EMAIL', 'SOCIAL', 'SEARCH'] as const,
      objective: 'Acquire derivatives-ready traders through a free webinar series',
      budget: 850000,
      actualSpend: 612400,
      startsAt: daysAgo(75),
      endsAt: daysAhead(15),
      status: 'RUNNING' as const,
    },
    {
      reference: 'CM-2026-000002',
      code: 'ZERO-AMC-DEMAT',
      name: 'Zero AMC Demat — Gujarat Push',
      channels: ['WHATSAPP', 'SMS', 'OFFLINE'] as const,
      objective: 'Retail demat acquisition across Tier-2 Gujarat',
      budget: 450000,
      actualSpend: 448900,
      startsAt: daysAgo(120),
      endsAt: daysAgo(20),
      status: 'COMPLETED' as const,
    },
    {
      reference: 'CM-2026-000003',
      code: 'NRI-GIFT-CITY',
      name: 'NRI Investing via GIFT City',
      channels: ['EMAIL', 'DISPLAY'] as const,
      objective: 'Build an NRI pipeline ahead of the GIFT City launch',
      budget: 300000,
      actualSpend: 41200,
      startsAt: daysAgo(10),
      endsAt: daysAhead(80),
      status: 'RUNNING' as const,
    },
  ];

  const created = [];
  for (const campaign of campaigns) {
    created.push(
      await prisma.campaign.upsert({
        where: { code: campaign.code },
        update: {},
        create: { ...campaign, channels: [...campaign.channels] },
      }),
    );
  }
  console.log(`  campaigns: ${created.length}`);
  return created;
}

const FIRST_NAMES = [
  'Aarav', 'Ishaan', 'Vivaan', 'Kabir', 'Rudra', 'Hetal', 'Jayesh', 'Bhavin', 'Nilesh', 'Paresh',
  'Ananya', 'Diya', 'Meera', 'Kavya', 'Riya', 'Falguni', 'Hiral', 'Jigna', 'Krupa', 'Nidhi',
  'Chirag', 'Darshan', 'Harsh', 'Kalpesh', 'Manan', 'Parth', 'Rohan', 'Tejas', 'Yash', 'Dhruv',
];
const LAST_NAMES = [
  'Patel', 'Shah', 'Desai', 'Mehta', 'Joshi', 'Trivedi', 'Vyas', 'Amin', 'Modi', 'Parikh',
  'Bhatt', 'Dave', 'Gandhi', 'Kapadia', 'Raval', 'Solanki', 'Chauhan', 'Panchal', 'Thakkar', 'Soni',
];
const CITIES: Array<[string, string, string]> = [
  ['Ahmedabad', 'Gujarat', '380015'],
  ['Surat', 'Gujarat', '395007'],
  ['Vadodara', 'Gujarat', '390007'],
  ['Rajkot', 'Gujarat', '360005'],
  ['Gandhinagar', 'Gujarat', '382010'],
  ['Mumbai', 'Maharashtra', '400051'],
  ['Pune', 'Maharashtra', '411004'],
  ['Bhavnagar', 'Gujarat', '364001'],
];

async function seedLeadsAndCustomers(
  users: Map<string, { id: string; orgUnitId: string | null }>,
  orgUnits: Map<string, { id: string; path: string }>,
  partnerId: string,
  campaigns: Array<{ id: string; code: string }>,
) {
  const existing = await prisma.lead.count();
  if (existing > 0) {
    console.log(`  leads: skipped (${existing} already present)`);
    return;
  }

  const salesUsers = [
    { email: 'rahul.mehta@sihl.in', org: 'AHM-HO' },
    { email: 'sneha.patel@sihl.in', org: 'AHM-SAT' },
    { email: 'vikram.joshi@sihl.in', org: 'SUR' },
    { email: 'anita.raval@sihl.in', org: 'VAD' },
  ];

  const sources = ['WEBSITE', 'CAMPAIGN', 'REFERRAL', 'PARTNER', 'WALK_IN', 'INBOUND_CALL', 'SOCIAL'] as const;
  const products = ['EQUITY', 'DERIVATIVES', 'MUTUAL_FUNDS', 'IPO', 'COMMODITY', 'PMS', 'NRI', 'ALGO'] as const;
  const statuses = ['NEW', 'NEW', 'CONTACTED', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'LOST', 'DISQUALIFIED'] as const;

  let leadCounter = 0;
  let customerCounter = 0;
  const createdLeadIds: string[] = [];

  for (let index = 0; index < 64; index += 1) {
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const [city, state, pincode] = pick(CITIES);
    const source = pick(sources);
    const assignee = pick(salesUsers);
    const owner = users.get(assignee.email)!;

    // 9 followed by 9 digits, unique per lead — the partial unique index on
    // mobile means collisions would abort the seed.
    // Deliberately unmistakable: 90000xxxxx, sequential.
    //
    // India has no reserved fictional-number range, so the protection cannot be
    // "unroutable" — it has to be *obvious*. Nobody looking at a list of leads
    // whose mobiles run 9000000001, 9000000002 thinks those are real people,
    // and a salesperson exploring a demo will not dial one. The previous
    // generator produced 97xxxxxxxx numbers that are allocated and answerable.
    const mobile = `90000${String(index + 1).padStart(5, '0')}`;

    const ageDays = Math.floor(random() * 90);
    const createdAt = daysAgo(ageDays);

    // Roughly one in six leads converts, which is a believable retail broking
    // funnel — a demo book where half the leads convert teaches the wrong thing.
    const converts = random() < 0.17 && ageDays > 10;
    const status = converts ? 'CONVERTED' : pick(statuses);

    leadCounter += 1;
    const reference = `LD-2026-${String(leadCounter).padStart(6, '0')}`;

    const productInterest = pickMany(products, 3);
    const isPartnerSourced = source === 'PARTNER';
    const campaign = source === 'CAMPAIGN' ? pick(campaigns) : null;

    const lastActivityDays = Math.floor(random() * Math.max(1, ageDays));

    const lead = await prisma.lead.create({
      data: {
        reference,
        firstName,
        lastName,
        mobile,
        email: random() > 0.25 ? `${firstName.toLowerCase()}.${lastName.toLowerCase()}${index}@gmail.com` : null,
        city,
        state,
        pincode,
        status,
        source,
        priority: random() > 0.75 ? 'HIGH' : random() > 0.3 ? 'MEDIUM' : 'LOW',
        productInterest: [...productInterest],
        estimatedValue: Math.round((25000 + random() * 4_500_000) / 1000) * 1000,
        ownerId: random() > 0.08 ? owner.id : null,
        orgUnitId: orgUnits.get(assignee.org)!.id,
        partnerId: isPartnerSourced ? partnerId : null,
        campaignId: campaign?.id ?? null,
        utmSource: campaign ? 'google' : source === 'SOCIAL' ? 'facebook' : null,
        utmMedium: campaign ? 'cpc' : source === 'SOCIAL' ? 'social' : null,
        utmCampaign: campaign?.code ?? null,
        landingPath: source === 'WEBSITE' ? '/open-demat-account' : null,
        createdAt,
        updatedAt: createdAt,
        lastActivityAt: daysAgo(lastActivityDays),
        contactedAt: status === 'NEW' ? null : daysAgo(Math.max(0, ageDays - 2)),
        qualifiedAt: ['QUALIFIED', 'PROPOSAL', 'CONVERTED'].includes(status)
          ? daysAgo(Math.max(0, ageDays - 5))
          : null,
        nextFollowUpAt: ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL'].includes(status)
          ? random() > 0.35
            ? daysAhead(Math.floor(random() * 10))
            : daysAgo(Math.floor(random() * 6)) // deliberately overdue
          : null,
        lostReason: status === 'LOST' ? pick(['PRICE', 'COMPETITOR', 'NOT_INTERESTED', 'UNREACHABLE']) : null,
        convertedAt: status === 'CONVERTED' ? daysAgo(Math.max(0, ageDays - 8)) : null,
        closedAt: ['LOST', 'DISQUALIFIED', 'CONVERTED'].includes(status)
          ? daysAgo(Math.max(0, ageDays - 8))
          : null,
        createdById: owner.id,
      },
    });
    createdLeadIds.push(lead.id);
    // Scores are written through the same scorer the API uses, not invented.
    // A demo book where every lead scores 0 makes the whole scoring feature —
    // the hot-lead filter, the pipeline sort, the dashboard tile — look broken.
    // Activity rows are created below, so the count is computed first here.
    const seedActivityCount = status === 'NEW' ? Math.floor(random() * 2) : 1 + Math.floor(random() * 5);

    await prisma.leadStatusHistory.create({
      data: { leadId: lead.id, toStatus: 'NEW', changedAt: createdAt, changedById: owner.id },
    });
    if (status !== 'NEW') {
      await prisma.leadStatusHistory.create({
        data: {
          leadId: lead.id,
          fromStatus: 'NEW',
          toStatus: status,
          changedAt: daysAgo(Math.max(0, ageDays - 3)),
          changedById: owner.id,
          durationSeconds: 3 * 86400,
        },
      });
    }

    const features: ScoringFeatures = {
      source,
      productInterest,
      hasEmail: Boolean(lead.email),
      hasPan: false,
      hasCity: true,
      activityCount: seedActivityCount,
      ageInDays: ageDays,
      daysSinceLastActivity: lastActivityDays,
      estimatedValue: Number(lead.estimatedValue),
      hasCampaignAttribution: Boolean(campaign),
    };
    const scored = scoreLead(features);
    await prisma.lead.update({
      where: { id: lead.id },
      data: { score: scored.score, scoreFactors: scored.factors, scoredAt: new Date() },
    });

    // Interaction history, weighted so further-along leads have more of it.
    //
    // The first interaction lands within hours of the lead arriving and the
    // rest spread over its life. Scattering all of them uniformly across the
    // lead's age — the obvious thing to write — puts median first contact at
    // half the lead's age, which made every seeded rep look negligent on the
    // scorecard and had nothing to do with the product.
    const activityCount = seedActivityCount;
    const firstResponseHours = 0.5 + random() * 20;
    for (let a = 0; a < activityCount; a += 1) {
      const type = pick(['CALL', 'CALL', 'WHATSAPP', 'EMAIL', 'MEETING'] as const);
      await prisma.activity.create({
        data: {
          entityType: 'LEAD',
          entityId: lead.id,
          type,
          direction: random() > 0.3 ? 'OUTBOUND' : 'INBOUND',
          subject:
            type === 'CALL'
              ? 'Discovery call'
              : type === 'MEETING'
                ? 'Branch meeting'
                : type === 'WHATSAPP'
                  ? 'Shared brokerage plan on WhatsApp'
                  : 'Emailed account opening pack',
          body:
            type === 'CALL'
              ? `Discussed ${productInterest.join(', ').toLowerCase()}. Customer asked about brokerage slabs and margin funding.`
              : null,
          outcome: pick(['Interested', 'Call back later', 'Needs to discuss with family', 'Comparing brokers']),
          durationMinutes: type === 'CALL' ? 3 + Math.floor(random() * 18) : null,
          occurredAt:
            a === 0
              ? daysAgo(ageDays - firstResponseHours / 24)
              : daysAgo(random() * Math.max(0.5, ageDays)),
          actorId: owner.id,
        },
      });
    }

    if (status === 'CONVERTED') {
      customerCounter += 1;
      const stage = pick([
        'KYC_STARTED', 'PAN_VERIFIED', 'ESIGN_PENDING', 'UNDER_REVIEW', 'ACCOUNT_OPENED', 'ACTIVATED', 'ACTIVATED',
      ] as const);
      const activated = stage === 'ACTIVATED';

      const customer = await prisma.customer.create({
        data: {
          reference: `CU-2026-${String(customerCounter).padStart(6, '0')}`,
          clientCode: activated ? `SIHL${String(40000 + customerCounter)}` : null,
          firstName,
          lastName,
          email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${index}@gmail.com`,
          mobile,
          pan: `${lastName.slice(0, 3).toUpperCase()}${firstName.slice(0, 2).toUpperCase()}${String(1000 + index)}${'ABCDEFGHJK'[index % 10]}`,
          city,
          state,
          pincode,
          status: activated ? 'ACTIVE' : 'ONBOARDING',
          kycStatus: activated ? 'COMPLETED' : pick(['IN_PROGRESS', 'PENDING_VERIFICATION'] as const),
          onboardingStage: stage,
          stageUpdatedAt: daysAgo(Math.floor(random() * 12)),
          accountOpenedAt: ['ACCOUNT_OPENED', 'ACTIVATED'].includes(stage) ? daysAgo(6) : null,
          activatedAt: activated ? daysAgo(4) : null,
          firstTradeAt: activated && random() > 0.4 ? daysAgo(2) : null,
          productInterest: [...productInterest],
          relationshipManagerId: owner.id,
          orgUnitId: orgUnits.get(assignee.org)!.id,
          partnerId: isPartnerSourced ? partnerId : null,
          createdAt: lead.convertedAt ?? createdAt,
        },
      });

      await prisma.lead.update({ where: { id: lead.id }, data: { customerId: customer.id } });

      if (activated) {
        await prisma.customerProduct.create({
          data: {
            customerId: customer.id,
            product: productInterest[0]!,
            status: 'ACTIVE',
            openedAt: daysAgo(5),
            currentValue: Math.round(random() * 2_500_000),
            sourceSystem: 'BACKOFFICE',
            externalRef: `BO-${customer.clientCode}`,
            syncedAt: new Date(),
          },
        });
      }
    }
  }

  // Follow-up tasks, some deliberately overdue so the dashboard has something
  // to be red about.
  const openLeads = await prisma.lead.findMany({
    where: { status: { in: ['CONTACTED', 'QUALIFIED', 'PROPOSAL'] } },
    select: { id: true, ownerId: true, firstName: true, lastName: true },
    take: 22,
  });

  let taskCounter = 0;
  for (const lead of openLeads) {
    if (!lead.ownerId) continue;
    taskCounter += 1;
    await prisma.task.create({
      data: {
        reference: `TK-2026-${String(taskCounter).padStart(6, '0')}`,
        entityType: 'LEAD',
        entityId: lead.id,
        title: `Follow up with ${lead.firstName} ${lead.lastName ?? ''}`.trim(),
        description: 'Confirm documents and walk through the brokerage plan.',
        status: random() > 0.75 ? 'DONE' : 'OPEN',
        priority: random() > 0.7 ? 'HIGH' : 'MEDIUM',
        dueAt: random() > 0.4 ? daysAhead(Math.floor(random() * 6)) : daysAgo(Math.floor(random() * 4)),
        assigneeId: lead.ownerId,
        createdById: lead.ownerId,
        completedAt: random() > 0.75 ? daysAgo(1) : null,
      },
    });
  }

  // ---------------------------------------------------------------------
  // Advance the reference counters past everything this seed just issued.
  //
  // The seed writes references directly (LD-2026-000001…) rather than calling
  // ReferenceService, because doing 64 round-trips through an atomic counter
  // to generate predictable demo data would be slow and pointless. But leaving
  // the counter at zero means the *first* real lead created through the UI is
  // handed LD-2026-000001 — which already exists — and the user gets a unique
  // constraint violation on their very first action.
  //
  // Anything that issues references outside ReferenceService has to reconcile
  // them here. That includes any future data-migration script.
  // ---------------------------------------------------------------------
  const year = new Date().getFullYear();
  const counters: Array<[string, number]> = [
    [`LD-${year}`, leadCounter],
    [`CU-${year}`, customerCounter],
    [`TK-${year}`, taskCounter],
    [`PT-${year}`, 1],
    [`CM-${year}`, 3],
  ];

  for (const [key, value] of counters) {
    // GREATEST, not a plain assignment: re-running the seed against a database
    // that has since taken real traffic must never rewind the counter and start
    // reissuing references that are already in use.
    await prisma.$executeRaw`
      INSERT INTO "counter" ("key", "value", "updatedAt")
      VALUES (${key}, ${value}, NOW())
      ON CONFLICT ("key")
      DO UPDATE SET "value" = GREATEST("counter"."value", ${value}), "updatedAt" = NOW()
    `;
  }

  console.log(
    `  leads: ${leadCounter}, customers: ${customerCounter}, tasks: ${taskCounter} ` +
      `(reference counters advanced)`,
  );
}

async function main(): Promise<void> {
  console.log('Seeding SIHL ONE…');

  // Reference data — safe everywhere.
  await seedRoles();
  const designations = await seedDesignations();
  const orgUnits = await seedOrgUnits();

  if (process.env.NODE_ENV === 'production') {
    console.log('  NODE_ENV=production — skipping demo data.');
    return;
  }

  const users = await seedUsers(orgUnits, designations);
  await seedTargets(users);
  const partner = await seedPartner(orgUnits);
  const campaigns = await seedCampaigns();
  await seedEvents(users, campaigns);
  await seedLeadsAndCustomers(users, orgUnits, partner.id, campaigns);

  console.log('\nDemo sign-ins (password for all: %s)', SEED_PASSWORD);
  console.log('  admin@sihl.in           Super Admin      — everything');
  console.log('  md@sihl.in              Management       — read-only, company-wide');
  console.log('  salesmanager@sihl.in    Sales Manager    — team scope, can assign');
  console.log('  rahul.mehta@sihl.in     Sales Executive  — own leads only');
  console.log('  marketing@sihl.in       Marketing        — campaigns and attribution');
  console.log('  ops@sihl.in             Operations       — onboarding and servicing');
  console.log('  partner@trinetrafin.in  Partner          — own sourced business only');
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
