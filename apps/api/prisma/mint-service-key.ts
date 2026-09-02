/**
 * Mints a service-account key.
 *
 * The key is printed once and never again — only its Argon2 hash is stored, so
 * there is no "show key" anywhere in the system. A lost key is re-minted and
 * the old one revoked, which is the behaviour you want: it makes rotation the
 * normal path rather than an emergency.
 *
 *   npx tsx prisma/mint-service-key.ts --list
 *   npx tsx prisma/mint-service-key.ts --name ceo-command-centre --days 365
 *   npx tsx prisma/mint-service-key.ts --name ceo-command-centre --days 365 --apply
 *   npx tsx prisma/mint-service-key.ts --revoke ceo-command-centre --apply
 *
 * Without `--apply` it reports what it would do and writes nothing. Additive
 * only: it never updates or deletes a row, and `--revoke` sets a timestamp
 * rather than removing anything, so a revoked key's audit history still has
 * something to point at.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';

import { hash, Algorithm } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client';

// The four `analytics:*:read` permissions, which is everything a reporting
// integration such as the CEO command centre needs and nothing else. Kept as a
// literal rather than imported so this script has no build step.
const REPORTING = [
  'analytics:sales:read',
  'analytics:management:read',
  'analytics:marketing:read',
  'analytics:partner:read',
];

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}
const has = (flag: string) => process.argv.includes(flag);

const APPLY = has('--apply');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  try {
    if (has('--list')) {
      const all = await prisma.serviceAccount.findMany({ orderBy: { createdAt: 'asc' } });
      if (all.length === 0) {
        console.log('No service accounts.');
        return;
      }
      const now = new Date();
      for (const a of all) {
        const state = a.revokedAt
          ? 'REVOKED'
          : !a.isActive
            ? 'DISABLED'
            : a.expiresAt <= now
              ? 'EXPIRED'
              : 'active';
        console.log(
          `  ${a.name.padEnd(24)} ${state.padEnd(9)} ` +
            `expires ${a.expiresAt.toISOString().slice(0, 10)}  ` +
            `last used ${a.lastUsedAt ? a.lastUsedAt.toISOString().slice(0, 16) : 'never'}  ` +
            `[${a.keyPrefix}]  ${a.permissions.length} permissions`,
        );
      }
      return;
    }

    const revoke = arg('--revoke');
    if (revoke) {
      const account = await prisma.serviceAccount.findUnique({ where: { name: revoke } });
      if (!account) throw new Error(`No service account named ${revoke}`);
      if (account.revokedAt) {
        console.log(`${revoke} was already revoked on ${account.revokedAt.toISOString()}.`);
        return;
      }
      if (!APPLY) {
        console.log(`Would revoke ${revoke} (${account.keyPrefix}). Re-run with --apply.`);
        return;
      }
      await prisma.serviceAccount.update({
        where: { id: account.id },
        data: { revokedAt: new Date(), isActive: false },
      });
      console.log(`Revoked ${revoke}. Its key stops working on the next request.`);
      return;
    }

    const name = arg('--name');
    if (!name) throw new Error('Pass --name <machine-name>, or --list, or --revoke <name>');
    if (!/^[a-z0-9][a-z0-9-]{2,59}$/.test(name)) {
      throw new Error('Name must be lowercase letters, digits and hyphens, 3-60 characters');
    }

    const days = Number(arg('--days') ?? '365');
    if (!Number.isFinite(days) || days < 1 || days > 730) {
      throw new Error('--days must be between 1 and 730');
    }
    const expiresAt = new Date(Date.now() + days * 86_400_000);

    const existing = await prisma.serviceAccount.findUnique({ where: { name } });
    if (existing) {
      throw new Error(
        `A service account named ${name} already exists (${existing.keyPrefix}). ` +
          `Revoke it first, then mint a replacement under a new name.`,
      );
    }

    const createdByLabel = arg('--by') ?? 'CPAIO (mint-service-key.ts)';

    console.log(`\n  name        ${name}`);
    console.log(`  permissions ${REPORTING.join(', ')}`);
    console.log(`  data scope  ALL`);
    console.log(`  expires     ${expiresAt.toISOString().slice(0, 10)} (${days} days)`);
    console.log(`  created by  ${createdByLabel}\n`);

    if (!APPLY) {
      console.log('Nothing written. Re-run with --apply to mint the key.');
      return;
    }

    const pepper = process.env.PASSWORD_PEPPER;
    if (!pepper) {
      // Without the pepper the hash would be computed differently from the way
      // the API verifies it, and the key would be rejected on first use — with
      // no way to tell that from a wrong key.
      throw new Error('PASSWORD_PEPPER is not set; the minted key would not verify');
    }

    // Hex, not base64url: `_` is the separator and base64url's alphabet
    // contains it. See the parser in service-account.service.ts.
    const prefix = randomBytes(6).toString('hex');
    const secret = randomBytes(32).toString('base64url');
    const keyHash = await hash(`${secret}${pepper}`, {
      algorithm: Algorithm.Argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });

    await prisma.serviceAccount.create({
      data: {
        name,
        description: arg('--description') ?? null,
        keyPrefix: prefix,
        keyHash,
        permissions: REPORTING,
        dataScope: 'ALL',
        expiresAt,
        createdByLabel,
      },
    });

    console.log('  ------------------------------------------------------------');
    console.log(`  sihl_svc_${prefix}_${secret}`);
    console.log('  ------------------------------------------------------------');
    console.log('  Shown once. Store it in the consuming system’s secret store now.');
    console.log('  Send it as the X-Service-Key header. Not in a URL, not in a ticket.\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
