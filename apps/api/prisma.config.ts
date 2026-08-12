import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 no longer reads `.env` implicitly, no longer accepts `url` in the
 * schema, and no longer takes the seed command from package.json — all three
 * move here. `.env` is loaded above so one file drives the API, the migrations
 * and the seed.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
