import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client';
import { syncDesignations, syncRolePermissions } from './role-catalogue';

/**
 * Applies the RBAC matrix to the database. Run on every deploy.
 *
 * A schema change reaches an environment because `prisma migrate deploy` runs
 * in the entrypoint. A permission change had no equivalent: it needed somebody
 * to remember to run the seed, and `SEED_ON_BOOT` is false everywhere precisely
 * because the rest of the seed must not run against live data. So the matrix
 * and the database drifted, and the code that read the matrix was correct while
 * the system that enforced it was not.
 *
 * This is the missing half of that pipeline. Idempotent, additive to three
 * columns of one table, and safe to run on a database with live client data.
 *
 * Failure is loud but not fatal to the boot: the entrypoint logs and carries on,
 * because an API that starts with yesterday's permissions is better than one
 * that will not start at all. The log line is the signal that a permission
 * change has not landed.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  try {
    const results = await syncRolePermissions(prisma);

    let changed = 0;
    for (const result of results) {
      if (result.created) {
        console.log(`  + ${result.code} created with ${result.added.length} permissions`);
        changed += 1;
        continue;
      }
      if (result.added.length === 0 && result.removed.length === 0) continue;

      changed += 1;
      const parts: string[] = [];
      if (result.added.length) parts.push(`+${result.added.join(' +')}`);
      if (result.removed.length) parts.push(`-${result.removed.join(' -')}`);
      console.log(`  ~ ${result.code}: ${parts.join('  ')}`);
    }

    console.log(
      changed === 0
        ? `Role permissions already in sync (${results.length} roles).`
        : `Role permissions synced — ${changed} of ${results.length} roles changed.`,
    );

    const newDesignations = await syncDesignations(prisma);
    console.log(
      newDesignations.length === 0
        ? 'Designation ladder already in sync.'
        : `Designations added: ${newDesignations.join(', ')}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Role permission sync failed:', error);
  process.exit(1);
});
