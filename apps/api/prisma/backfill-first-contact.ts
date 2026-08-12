/**
 * One-off repair of demo interaction timestamps.
 *
 * The original seed scattered every activity uniformly across a lead's life, so
 * the *first* one landed at roughly half the lead's age. That put median first
 * contact at 240 hours for every seeded rep, which made the scorecard read as
 * though the whole sales floor was negligent — an artefact of the seed, not of
 * anything the product measures wrongly.
 *
 * The seed is fixed for fresh databases; this pulls the earliest activity on
 * each existing seeded lead back to within a plausible few hours of the lead
 * arriving. It touches nothing but `occurredAt`, and only on leads whose
 * reference matches the seed's own numbering.
 *
 *   npx tsx prisma/backfill-first-contact.ts
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const HOUR_MS = 3_600_000;

async function main(): Promise<void> {
  const leads = await prisma.lead.findMany({
    where: { reference: { startsWith: 'LD-2026-' } },
    select: { id: true, createdAt: true },
  });

  let repaired = 0;

  for (const lead of leads) {
    const first = await prisma.activity.findFirst({
      where: { entityType: 'LEAD', entityId: lead.id, isSystemGenerated: false },
      orderBy: { occurredAt: 'asc' },
      select: { id: true, occurredAt: true },
    });
    if (!first) continue;

    const delayHours = (first.occurredAt.getTime() - lead.createdAt.getTime()) / HOUR_MS;
    if (delayHours <= 24) continue;

    // Deterministic from the id, so re-running produces the same book rather
    // than walking the numbers every time someone runs it twice.
    const jitter = (lead.id.charCodeAt(lead.id.length - 1) % 20) + 0.5;

    await prisma.activity.update({
      where: { id: first.id },
      data: { occurredAt: new Date(lead.createdAt.getTime() + jitter * HOUR_MS) },
    });
    repaired += 1;
  }

  console.log(`Repaired first contact on ${repaired} of ${leads.length} seeded leads.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
