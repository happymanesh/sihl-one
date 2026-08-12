import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { APP_CONFIG, buildAppConfig, validateEnv, type AppConfig, type Env } from './configuration';

/**
 * Provides the single validated, typed `AppConfig` object.
 *
 * It lives in its own module rather than in AppModule's `providers` because
 * `ThrottlerModule.forRootAsync` (and any other `forRootAsync`) resolves its
 * injections against its own module scope — a provider declared alongside it in
 * AppModule is not visible to it. A @Global module that exports the token is.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // The process refuses to boot on invalid configuration. A missing secret
      // should fail on deploy, not at the first request that needs it.
      validate: validateEnv,
      cache: true,
    }),
  ],
  providers: [
    {
      provide: APP_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): AppConfig => {
        const read = <K extends keyof Env>(key: K): Env[K] => config.getOrThrow(key as string);
        return buildAppConfig({
          NODE_ENV: read('NODE_ENV'),
          DATABASE_URL: read('DATABASE_URL'),
          API_PORT: read('API_PORT'),
          API_GLOBAL_PREFIX: read('API_GLOBAL_PREFIX'),
          CORS_ORIGINS: read('CORS_ORIGINS'),
          IDENTITY_PROVIDER: read('IDENTITY_PROVIDER'),
          JWT_ISSUER: read('JWT_ISSUER'),
          JWT_AUDIENCE: read('JWT_AUDIENCE'),
          JWT_ACCESS_SECRET: read('JWT_ACCESS_SECRET'),
          JWT_REFRESH_SECRET: read('JWT_REFRESH_SECRET'),
          JWT_ACCESS_TTL: read('JWT_ACCESS_TTL'),
          JWT_REFRESH_TTL: read('JWT_REFRESH_TTL'),
          PASSWORD_PEPPER: read('PASSWORD_PEPPER'),
          AUTH_MAX_FAILED_ATTEMPTS: read('AUTH_MAX_FAILED_ATTEMPTS'),
          AUTH_LOCKOUT_MINUTES: read('AUTH_LOCKOUT_MINUTES'),
          RATE_LIMIT_TTL: read('RATE_LIMIT_TTL'),
          RATE_LIMIT_LIMIT: read('RATE_LIMIT_LIMIT'),
          STORAGE_DRIVER: read('STORAGE_DRIVER'),
          STORAGE_LOCAL_ROOT: read('STORAGE_LOCAL_ROOT'),
          FILE_SCANNER_MODE: read('FILE_SCANNER_MODE'),
          OUTBOX_RELAY_ENABLED: read('OUTBOX_RELAY_ENABLED'),
          OUTBOX_RELAY_INTERVAL_MS: read('OUTBOX_RELAY_INTERVAL_MS'),
          OUTBOX_RELAY_BATCH_SIZE: read('OUTBOX_RELAY_BATCH_SIZE'),
          OUTBOX_MAX_ATTEMPTS: read('OUTBOX_MAX_ATTEMPTS'),
        });
      },
    },
  ],
  exports: [APP_CONFIG],
})
export class ConfigurationModule {}
