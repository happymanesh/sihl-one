/**
 * Removes verification debris and neutralises demo phone numbers.
 *
 * Two unrelated jobs, both needed before anyone outside the build sees this
 * database.
 *
 * **The debris** is leads, campaigns and events created by end-to-end test runs
 * — "Dup Probe", "E2E Prospect", `e2e-…` campaigns. Left in place, the first
 * person to open the duplicates queue reviews test rubbish and reports it as a
 * defect. Soft-deleted rather than dropped, because every screen already filters
 * on `deletedAt` and a soft delete cannot cascade into something unintended.
 *
 * **The phone numbers** are the more serious one. The original seed generated
 * numbers in the 97xxxxxxxx series, which is allocated and answerable. Hand six
 * salespeople a CRM full of leads and tell them to try it, and one of them will
 * press call — cold-calling a stranger from a SEBI-registered broker's system.
 * India has no reserved fictional range, so the protection is to make the
 * numbers unmistakable rather than unroutable: 90000xxxxx, sequential.
 *
 *   npx tsx prisma/clean-test-data.ts          # report only
 *   npx tsx prisma/clean-test-data.ts --apply  # make the changes
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const APPLY = process.argv.includes('--apply');

/** Names used by the e2e suites and by hand during verification. */
const DEBRIS_NAMES = [
  'Dup Probe',
  'Attribution Test',
  'Attribution Probe',
  'Coded Capture',
  'E2E Prospect',
  'Master Test',
  'Kavya Mehta',
  'Expo Visitor',
  'Referred Client',
  // Found by censusing the remaining names rather than by memory — the list
  // written from recollection missed both of these entirely.
  'Anonymous',
  'Repro',
];

async function main(): Promise<void> {
  const debrisWhere = {
    deletedAt: null,
    OR: DEBRIS_NAMES.map((full) => {
      const [firstName, lastName] = full.split(' ');
      return { firstName, ...(lastName ? { lastName } : {}) };
    }),
  };

  const debris = await prisma.lead.findMany({
    where: debrisWhere,
    select: { id: true, reference: true, firstName: true, lastName: true, customerId: true },
  });

  const testCampaigns = await prisma.campaign.findMany({
    where: { OR: [{ code: { startsWith: 'e2e-' } }, { code: { startsWith: 'attrib-' } }] },
    select: { id: true, code: true, name: true },
  });

  const testEvents = await prisma.event.findMany({
    where: { code: { startsWith: 'e2e-' } },
    select: { id: true, code: true },
  });

  console.log(`Debris leads         : ${debris.length}`);
  console.log(`Test campaigns       : ${testCampaigns.length}`);
  console.log(`Test events          : ${testEvents.length}`);

  const realLeads = await prisma.lead.findMany({
    where: { deletedAt: null, NOT: debrisWhere.OR.length ? { OR: debrisWhere.OR } : undefined },
    select: { id: true, mobile: true },
    orderBy: { createdAt: 'asc' },
  });
  const dialable = realLeads.filter((lead) => !lead.mobile.startsWith('90000'));
  console.log(`Leads to renumber    : ${dialable.length} of ${realLeads.length}`);

  const customers = await prisma.customer.findMany({
    where: { deletedAt: null },
    select: { id: true, mobile: true },
    orderBy: { createdAt: 'asc' },
  });
  const dialableCustomers = customers.filter((row) => !row.mobile.startsWith('90000'));
  console.log(`Customers to renumber: ${dialableCustomers.length} of ${customers.length}`);

  if (!APPLY) {
    console.log('\nReport only. Re-run with --apply to make these changes.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    const now = new Date();

    if (debris.length > 0) {
      const ids = debris.map((lead) => lead.id);
      await tx.lead.updateMany({ where: { id: { in: ids } }, data: { deletedAt: now } });

      // Converted debris left a customer behind. It has to go too, or the
      // customer list carries names nobody recognises.
      const customerIds = debris
        .map((lead) => lead.customerId)
        .filter((id): id is string => Boolean(id));
      if (customerIds.length > 0) {
        await tx.customer.updateMany({
          where: { id: { in: customerIds } },
          data: { deletedAt: now },
        });
      }
    }

    // Hard-deleted: `lead.campaignId` and `lead.eventId` are both SetNull, so
    // nothing is orphaned and no lead is lost.
    if (testCampaigns.length > 0) {
      await tx.campaign.deleteMany({ where: { id: { in: testCampaigns.map((c) => c.id) } } });
    }
    if (testEvents.length > 0) {
      await tx.event.deleteMany({ where: { id: { in: testEvents.map((e) => e.id) } } });
    }

    // Renumbered one at a time: `lead_active_mobile_key` is a partial unique
    // index, so a bulk update could collide with a row not yet moved. The
    // 90000 block is disjoint from everything currently stored, which is what
    // makes a straight sequential pass safe.
    let next = 1;
    for (const lead of dialable) {
      await tx.lead.update({
        where: { id: lead.id },
        data: { mobile: `90000${String(next++).padStart(5, '0')}` },
      });
    }

    let nextCustomer = 50_001;
    for (const customer of dialableCustomers) {
      await tx.customer.update({
        where: { id: customer.id },
        data: { mobile: `9000${String(nextCustomer++).padStart(6, '0')}` },
      });
    }

    await tx.partner.updateMany({
      where: { mobile: { not: { startsWith: '90000' } } },
      data: { mobile: '9000099999' },
    });
  });

  console.log('\nDone.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
