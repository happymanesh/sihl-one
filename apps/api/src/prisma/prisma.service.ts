import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

import { APP_CONFIG, type AppConfig } from '../config/configuration';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Prisma 7 uses driver adapters rather than its own Rust connection pool, so
 * the pool below is a plain `pg` pool: the same one the rest of the Node
 * ecosystem tunes and instruments.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({
      adapter: new PrismaPg({
        connectionString: config.database.url,
        // Sized for a single API pod. With N pods this must stay under
        // Postgres `max_connections` divided by N, or the pods will starve
        // each other under load — see docs/01-architecture/scaling.md.
        max: 20,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      }),
      log: config.isProduction ? ['warn', 'error'] : ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Truncates every table. Test-only, and it refuses to run outside tests —
   * "the test helper pointed at prod" is a real way to lose a database.
   */
  async truncateAllTables(): Promise<void> {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('truncateAllTables() is only available when NODE_ENV=test');
    }
    const tables = await this.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'
    `;
    const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
    if (list) await this.$executeRawUnsafe(`TRUNCATE TABLE ${list} CASCADE;`);
  }
}
