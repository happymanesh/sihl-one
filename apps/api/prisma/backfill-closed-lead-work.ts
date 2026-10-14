import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Stand down work left open on leads that are already closed.
 *
 * `standDownOpenWork` cancels tasks and visits as a lead closes, but it only
 * fires from the moment it shipped. Leads converted or lost before that still
 * carry open tasks and planned visits, so reps are still being told to chase
 * business that was finished weeks ago. This is the one-off for those.
 *
 * Reports by default and changes nothing. Pass `--apply` to write.
 *
 *   npx tsx prisma/backfill-closed-lead-work.ts            # counts only
 *   npx tsx prisma/backfill-closed-lead-work.ts --apply    # writes
 *
 * Idempotent: a second run finds nothing left to do. Safe to re-run after a
 * partial failure, which matters because this is not one transaction — it is
 * three bulk updates over live data, and holding a lock across all of them on
 * a busy table would be worse than being resumable.
 */
const CLOSED = ['CONVERTED', 'LOST', 'DISQUALIFIED'];

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  try {
    const closedLeads = await prisma.lead.findMany({
      where: { deletedAt: null, status: { in: CLOSED } },
      select: { id: true },
    });
    const ids = closedLeads.map((row) => row.id);
    console.log(`Closed leads: ${ids.length}`);

    if (ids.length === 0) {
      console.log('Nothing to do.');
      return;
    }

    const openCodes = (
      await prisma.taskStatusMaster.findMany({
        where: { category: { in: ['OPEN', 'IN_PROGRESS'] } },
        select: { code: true },
      })
    ).map((row) => row.code);

    const taskWhere = {
      entityType: 'LEAD' as const,
      entityId: { in: ids },
      status: { in: openCodes },
    };
    const visitWhere = {
      entityType: 'LEAD' as const,
      entityId: { in: ids },
      status: 'PLANNED' as const,
    };
    const followUpWhere = {
      entityType: 'LEAD' as const,
      entityId: { in: ids },
      nextFollowUpAt: { not: null },
    };

    const [tasks, visits, followUps] = await Promise.all([
      prisma.task.count({ where: taskWhere }),
      prisma.visit.count({ where: visitWhere }),
      prisma.visit.count({ where: followUpWhere }),
    ]);

    console.log(`  Open tasks on closed leads      : ${tasks}`);
    console.log(`  Planned visits on closed leads  : ${visits}`);
    console.log(`  Visit follow-up dates to clear  : ${followUps}`);

    if (!apply) {
      console.log('\nDry run. Re-run with --apply to make these changes.');
      return;
    }

    const cancelledTasks = await prisma.task.updateMany({
      where: taskWhere,
      data: { status: 'CANCELLED' },
    });
    const cancelledVisits = await prisma.visit.updateMany({
      where: visitWhere,
      data: { status: 'CANCELLED' },
    });
    const clearedFollowUps = await prisma.visit.updateMany({
      where: followUpWhere,
      data: { nextFollowUpAt: null },
    });

    console.log('\nApplied:');
    console.log(`  Tasks cancelled                 : ${cancelledTasks.count}`);
    console.log(`  Visits cancelled                : ${cancelledVisits.count}`);
    console.log(`  Visit follow-up dates cleared   : ${clearedFollowUps.count}`);

    const [tasksLeft, visitsLeft, followUpsLeft] = await Promise.all([
      prisma.task.count({ where: taskWhere }),
      prisma.visit.count({ where: visitWhere }),
      prisma.visit.count({ where: followUpWhere }),
    ]);
    console.log(`\nRemaining (should be 0/0/0): ${tasksLeft}/${visitsLeft}/${followUpsLeft}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
