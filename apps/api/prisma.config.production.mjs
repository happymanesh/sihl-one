import path from 'node:path';
import { defineConfig } from 'prisma/config';

/**
 * Migration config for the production image.
 *
 * Separate from prisma.config.ts because that file is TypeScript and imports
 * `dotenv/config` — both devDependencies, and both stripped by the runtime
 * image's `npm prune --omit=dev`. Prisma 7 refuses to run `migrate deploy`
 * without a config file supplying `datasource.url`, so the deployed container
 * needs one it can actually load.
 *
 * No dotenv here on purpose: in a container the environment is supplied by the
 * platform, and silently loading a stray .env would be a way to migrate the
 * wrong database.
 *
 * Paths are relative to the working directory, so the entrypoint runs this from
 * apps/api.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
