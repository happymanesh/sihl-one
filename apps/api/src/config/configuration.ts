import { z } from 'zod';

/**
 * Environment contract.
 *
 * Validated once at boot and the process refuses to start if anything is wrong.
 * A misconfigured secret should fail loudly on deploy, not silently at 3am when
 * the first token fails to verify.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    API_GLOBAL_PREFIX: z.string().default('api'),
    CORS_ORIGINS: z.string().default('http://localhost:3000'),

    IDENTITY_PROVIDER: z.enum(['local', 'synapse']).default('local'),
    JWT_ISSUER: z.string().min(1),
    JWT_AUDIENCE: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL: z.coerce.number().int().min(60).default(900),
    JWT_REFRESH_TTL: z.coerce.number().int().min(300).default(2_592_000),

    PASSWORD_PEPPER: z.string().min(8),

    AUTH_MAX_FAILED_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
    AUTH_LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),

    RATE_LIMIT_TTL: z.coerce.number().int().min(1).default(60),
    RATE_LIMIT_LIMIT: z.coerce.number().int().min(1).default(120),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_ROOT: z.string().default('storage'),
    // Opt-in acknowledgement that STORAGE_LOCAL_ROOT points at a persistent
    // mount rather than the container filesystem. Defaults to false so the
    // production guard below still catches the mistake it was written for.
    STORAGE_LOCAL_DURABLE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    FILE_SCANNER_MODE: z.enum(['noop', 'permissive', 'clamav']).default('noop'),

    OUTBOX_RELAY_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    OUTBOX_RELAY_INTERVAL_MS: z.coerce.number().int().min(1000).default(5000),
    OUTBOX_RELAY_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
    OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(8),

    SEED_PASSWORD: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    // Production-only checks. These are the mistakes that actually happen: a
    // .env copied from a dev machine straight onto a server.
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ — sharing them lets a stolen ' +
          'access token be replayed as a refresh token.',
        path: ['JWT_REFRESH_SECRET'],
      });
    }
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'PASSWORD_PEPPER'] as const) {
      if (env[key].includes('dev-only')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${key} still holds the development placeholder value.`,
          path: [key],
        });
      }
    }
    if (env.CORS_ORIGINS.includes('*')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'CORS_ORIGINS may not be a wildcard in production.',
        path: ['CORS_ORIGINS'],
      });
    }
    if (env.FILE_SCANNER_MODE === 'permissive') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'FILE_SCANNER_MODE=permissive marks every upload clean without scanning it. ' +
          'It is for development and CI only.',
        path: ['FILE_SCANNER_MODE'],
      });
    }
    if (env.STORAGE_DRIVER === 'local' && !env.STORAGE_LOCAL_DURABLE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'STORAGE_DRIVER=local writes uploads to the container filesystem, which is lost on ' +
          'restart and not shared between instances. Use s3 in production, or set ' +
          'STORAGE_LOCAL_DURABLE=true if STORAGE_LOCAL_ROOT is a persistent volume — that is ' +
          'only safe on a single instance, since a volume is not shared across replicas.',
        path: ['STORAGE_DRIVER'],
      });
    }
    if (env.STORAGE_LOCAL_DURABLE && !env.STORAGE_LOCAL_ROOT.startsWith('/')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'STORAGE_LOCAL_DURABLE=true but STORAGE_LOCAL_ROOT is a relative path, which resolves ' +
          'inside the container rather than to the mounted volume.',
        path: ['STORAGE_LOCAL_ROOT'],
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}

/** Typed view of the validated environment, consumed through ConfigService. */
export interface AppConfig {
  nodeEnv: Env['NODE_ENV'];
  isProduction: boolean;
  port: number;
  globalPrefix: string;
  corsOrigins: string[];
  database: { url: string };
  auth: {
    provider: Env['IDENTITY_PROVIDER'];
    issuer: string;
    audience: string;
    accessSecret: string;
    refreshSecret: string;
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
    pepper: string;
    maxFailedAttempts: number;
    lockoutMinutes: number;
  };
  rateLimit: { ttlSeconds: number; limit: number };
  storage: {
    driver: Env['STORAGE_DRIVER'];
    localRoot: string;
    localDurable: boolean;
    scannerMode: Env['FILE_SCANNER_MODE'];
  };
  outbox: {
    enabled: boolean;
    intervalMs: number;
    batchSize: number;
    maxAttempts: number;
  };
}

export function buildAppConfig(env: Env): AppConfig {
  return {
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    port: env.API_PORT,
    globalPrefix: env.API_GLOBAL_PREFIX,
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    database: { url: env.DATABASE_URL },
    auth: {
      provider: env.IDENTITY_PROVIDER,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      accessSecret: env.JWT_ACCESS_SECRET,
      refreshSecret: env.JWT_REFRESH_SECRET,
      accessTtlSeconds: env.JWT_ACCESS_TTL,
      refreshTtlSeconds: env.JWT_REFRESH_TTL,
      pepper: env.PASSWORD_PEPPER,
      maxFailedAttempts: env.AUTH_MAX_FAILED_ATTEMPTS,
      lockoutMinutes: env.AUTH_LOCKOUT_MINUTES,
    },
    rateLimit: { ttlSeconds: env.RATE_LIMIT_TTL, limit: env.RATE_LIMIT_LIMIT },
    storage: {
      driver: env.STORAGE_DRIVER,
      localRoot: env.STORAGE_LOCAL_ROOT,
      localDurable: env.STORAGE_LOCAL_DURABLE,
      scannerMode: env.FILE_SCANNER_MODE,
    },
    outbox: {
      enabled: env.OUTBOX_RELAY_ENABLED,
      intervalMs: env.OUTBOX_RELAY_INTERVAL_MS,
      batchSize: env.OUTBOX_RELAY_BATCH_SIZE,
      maxAttempts: env.OUTBOX_MAX_ATTEMPTS,
    },
  };
}

export const APP_CONFIG = 'APP_CONFIG';
