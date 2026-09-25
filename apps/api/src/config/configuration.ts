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
    /**
     * Sign the user out after this long without activity. Distinct from
     * JWT_ACCESS_TTL, which is how long one access token lives — that renews
     * silently, so on its own it keeps a session alive for the refresh
     * token's full lifetime.
     */
    AUTH_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().min(5).max(1440).default(15),

    RATE_LIMIT_TTL: z.coerce.number().int().min(1).default(60),
    RATE_LIMIT_LIMIT: z.coerce.number().int().min(1).default(120),

    /**
     * The public address of the web app. This is what gets encoded into the QR
     * on an event banner and a partner's card, so a wrong value is not a
     * degraded experience — it is a printed sheet of paper that does nothing.
     * Validated here because it was being read straight from process.env with a
     * localhost fallback, which fails silently and only in the one place nobody
     * can check after the fact.
     */
    PUBLIC_WEB_URL: z.string().url().default('http://localhost:3000'),

    /*
      Where the brochure library lives.

      Configurable so the library can move — to the corporate site, to object
      storage — without a release. Defaults to the web app's own public folder,
      which works out of the box and costs a release to change a PDF.
    */
    BROCHURE_BASE_URL: z.string().url().optional(),
    /** Printed in visitor-facing email, so it belongs in configuration. */
    SUPPORT_PHONE: z.string().min(1).default('079-6508-1699'),
    SUPPORT_EMAIL: z.string().email().default('helpdesk@sihl.in'),

    /**
     * Outbound email for system messages — today only the password-reset
     * notice. Defaults to `noop`, which logs and sends nothing, so a
     * developer or a CI run can never mail a real person by accident.
     */
    MAIL_DRIVER: z.enum(['noop', 'sendgrid']).default('noop'),
    SENDGRID_API_KEY: z.string().min(1).optional(),
    /** Must be a verified sender, or on a domain authenticated in SendGrid. */
    MAIL_FROM: z.string().email().optional(),
    MAIL_FROM_NAME: z.string().min(1).default('SIHL LMS+'),
    /**
     * The address staff see in links. Separate from CORS_ORIGINS because that
     * is a security allow-list and this is a public, human-facing URL — reusing
     * one for the other means a CORS change silently rewrites customer email.
     */
    MAIL_APP_URL: z.string().url().optional(),

    /**
     * SMS, for mobile verification at event registration.
     *
     * `noop` by default and for the same reason as mail: a developer or a CI
     * run must never be able to text a real person by accident, and every send
     * costs money. Switching to `onlysms` requires every credential below,
     * checked at boot rather than discovered at a stall.
     */
    SMS_DRIVER: z.enum(['noop', 'onlysms']).default('noop'),
    SMS_USER_ID: z.string().min(1).optional(),
    SMS_PASSWORD: z.string().min(1).optional(),
    /** The six-character sender header registered on DLT. */
    SMS_SENDER_ID: z.string().min(1).optional(),
    /** Principal Entity ID — identifies SIHL to the operator. */
    SMS_PE_ID: z.string().min(1).optional(),
    /** Content template id. Must match the text being sent, exactly. */
    SMS_OTP_TEMPLATE_ID: z.string().min(1).optional(),

    /*
      The event-registration message, sent once a number is confirmed.

      The template id and the route are separate settings on purpose. The route
      depends on the category the template was registered under, not on its
      words, and getting it wrong means the gateway accepts every message and
      the operator delivers none — with a 100 in the response either way. Being
      able to flip it with a variable and a restart is the difference between a
      five-minute fix at a stall and a day of blind diagnosis.
    */
    SMS_EVENT_TEMPLATE_ID: z.string().min(1).default('1777179032758734926'),
    SMS_EVENT_ROUTE: z.enum(['text', 'otp']).default('text'),
    /*
      What follows "event schedule and details" in the message.

      Not validated as a URL, deliberately. It usually is one — but on 25-Sep
      every message carrying a link was accepted by the gateway and dropped by
      the operator, whatever the domain: the entity has no URL whitelisting.
      Until that is arranged the only message that arrives is one with no link
      at all, and requiring a URL here would make the honest fallback
      unconfigurable without a release.

      It is one variable in an approved DLT template, and the template allows
      any content there. Trimmed, because a stray space changes the rendered
      text and the operator compares what it receives against what was
      registered.
    */
    SMS_EVENT_LINK: z.string().trim().min(1).optional(),
    SMS_TEXT_URL: z.string().url().default('https://onlysms.co.in/api/sms.aspx'),
    SMS_OTP_URL: z.string().url().default('https://onlysms.co.in/api/otp.aspx'),

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
    /**
     * Where clamd listens. On Railway this is the private hostname of the
     * ClamAV service, which is not reachable from the public internet — the
     * scanner must never be exposed, since it accepts arbitrary bytes.
     */
    CLAMAV_HOST: z.string().min(1).optional(),
    CLAMAV_PORT: z.coerce.number().int().min(1).max(65_535).default(3310),
    /**
     * clamd loads its signature database at startup and refuses connections
     * until it is ready, which takes tens of seconds after a deploy. This has
     * to outlast that without holding a request thread indefinitely.
     */
    CLAMAV_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),

    /**
     * Reverse geocoding for the check-in photo stamp. Off by default: the stamp
     * is complete with coordinates and a timestamp, and an address is an
     * improvement rather than a requirement.
     */
    GEOCODER: z.enum(['none', 'mappls']).default('none'),
    MAPPLS_CLIENT_ID: z.string().min(1).optional(),
    MAPPLS_CLIENT_SECRET: z.string().min(1).optional(),
    /** Both configurable: their API host has moved more than once. */
    MAPPLS_TOKEN_URL: z
      .string()
      .url()
      .default('https://outpost.mappls.com/api/security/oauth/token'),
    MAPPLS_REVERSE_URL: z
      .string()
      .url()
      .default('https://apis.mappls.com/advancedmaps/v1/rev_geocode'),
    /**
     * Short on purpose. This runs while a rep waits to check in, and a slow
     * answer is worth less than a fast blank.
     */
    GEOCODER_TIMEOUT_MS: z.coerce.number().int().min(500).max(15_000).default(4_000),

    /**
     * Dictation. Off by default; the control is visible but disabled until a
     * provider is configured, because reps were told it is coming.
     */
    SPEECH_PROVIDER: z.enum(['none', 'sarvam']).default('none'),
    SARVAM_API_KEY: z.string().min(1).optional(),
    /** Saaras models transcribe and translate; Saarika only transcribes. */
    SARVAM_STT_MODEL: z.string().min(1).default('saaras:v3'),
    SARVAM_STT_URL: z.string().url().default('https://api.sarvam.ai/speech-to-text-translate'),
    /**
     * Generous compared with geocoding: a rep has finished speaking and is
     * watching a spinner, so waiting is better than losing the note.
     */
    SPEECH_TIMEOUT_MS: z.coerce.number().int().min(2_000).max(120_000).default(45_000),

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
    // Checked in every environment: a scanner that cannot be reached marks
    // every upload FAILED, and that should be a boot error, not a mystery
    // discovered by a user who cannot download their own document.
    if (env.SPEECH_PROVIDER === 'sarvam' && !env.SARVAM_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SPEECH_PROVIDER=sarvam requires SARVAM_API_KEY.',
        path: ['SARVAM_API_KEY'],
      });
    }

    if (env.GEOCODER === 'mappls' && (!env.MAPPLS_CLIENT_ID || !env.MAPPLS_CLIENT_SECRET)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'GEOCODER=mappls requires MAPPLS_CLIENT_ID and MAPPLS_CLIENT_SECRET.',
        path: ['MAPPLS_CLIENT_ID'],
      });
    }

    if (env.FILE_SCANNER_MODE === 'clamav' && !env.CLAMAV_HOST) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'FILE_SCANNER_MODE=clamav requires CLAMAV_HOST.',
        path: ['CLAMAV_HOST'],
      });
    }

    // Caught at boot rather than at the first password reset. A missing key or
    // sender would otherwise surface as a member of staff locked out and
    // waiting for an email that was never going to arrive.
    /*
      Every credential, or none. A half-configured SMS driver fails at the
      worst possible moment — a rep at a stall with a queue, watching somebody
      wait for a code that was never going to arrive. Checked at boot instead,
      where it is a startup error somebody reads.
    */
    if (env.SMS_DRIVER === 'onlysms') {
      const required = [
        ['SMS_USER_ID', env.SMS_USER_ID],
        ['SMS_PASSWORD', env.SMS_PASSWORD],
        ['SMS_SENDER_ID', env.SMS_SENDER_ID],
        ['SMS_PE_ID', env.SMS_PE_ID],
        ['SMS_OTP_TEMPLATE_ID', env.SMS_OTP_TEMPLATE_ID],
      ] as const;

      for (const [name, value] of required) {
        if (!value) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `SMS_DRIVER=onlysms requires ${name}.`,
            path: [name],
          });
        }
      }
    }

    if (env.MAIL_DRIVER === 'sendgrid') {
      if (!env.SENDGRID_API_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'MAIL_DRIVER=sendgrid requires SENDGRID_API_KEY.',
          path: ['SENDGRID_API_KEY'],
        });
      }
      if (!env.MAIL_FROM) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'MAIL_DRIVER=sendgrid requires MAIL_FROM (a verified sender).',
          path: ['MAIL_FROM'],
        });
      }
      if (!env.MAIL_APP_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'MAIL_DRIVER=sendgrid requires MAIL_APP_URL for the sign-in link.',
          path: ['MAIL_APP_URL'],
        });
      }
    }

    if (env.NODE_ENV !== 'production') return;

    // A production build encoding localhost into a printed QR is the failure
    // this catches. Nobody discovers it until a banner is standing in a hall
    // and the codes scan to nothing.
    if (/localhost|127\.0\.0\.1/.test(env.PUBLIC_WEB_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'PUBLIC_WEB_URL must be the real public address in production, not localhost.',
        path: ['PUBLIC_WEB_URL'],
      });
    }

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
    idleTimeoutMinutes: number;
  };
  rateLimit: { ttlSeconds: number; limit: number };
  support: { phone: string; email: string };
  /** Where the brochure library is served from, without a trailing slash. */
  brochureBaseUrl: string;
  mail: {
    driver: Env['MAIL_DRIVER'];
    apiKey: string | undefined;
    from: string | undefined;
    fromName: string;
    appUrl: string | undefined;
  };
  sms: {
    driver: Env['SMS_DRIVER'];
    userId: string;
    password: string;
    senderId: string;
    peId: string;
    otpTemplateId: string;
    eventTemplateId: string;
    eventRoute: 'text' | 'otp';
    eventLink: string;
    textUrl: string;
    otpUrl: string;
  };
  storage: {
    driver: Env['STORAGE_DRIVER'];
    localRoot: string;
    localDurable: boolean;
    scannerMode: Env['FILE_SCANNER_MODE'];
    clamav: { host: string | undefined; port: number; timeoutMs: number };
  };
  speech: {
    provider: Env['SPEECH_PROVIDER'];
    timeoutMs: number;
    sarvam: { apiKey: string | undefined; model: string; endpoint: string };
  };
  geocoding: {
    provider: Env['GEOCODER'];
    timeoutMs: number;
    mappls: {
      clientId: string | undefined;
      clientSecret: string | undefined;
      tokenUrl: string;
      reverseUrl: string;
    };
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
      idleTimeoutMinutes: env.AUTH_IDLE_TIMEOUT_MINUTES,
    },
    rateLimit: { ttlSeconds: env.RATE_LIMIT_TTL, limit: env.RATE_LIMIT_LIMIT },
    support: { phone: env.SUPPORT_PHONE, email: env.SUPPORT_EMAIL },
    brochureBaseUrl: env.BROCHURE_BASE_URL ?? `${env.PUBLIC_WEB_URL}/brochures`,
    mail: {
      driver: env.MAIL_DRIVER,
      apiKey: env.SENDGRID_API_KEY,
      from: env.MAIL_FROM,
      fromName: env.MAIL_FROM_NAME,
      appUrl: env.MAIL_APP_URL,
    },
    /*
      Empty strings rather than undefined for the credentials: the refinement
      below guarantees they are present whenever the driver is `onlysms`, and
      the adapter would otherwise be littered with non-null assertions for a
      case that cannot happen.
    */
    sms: {
      driver: env.SMS_DRIVER,
      userId: env.SMS_USER_ID ?? '',
      password: env.SMS_PASSWORD ?? '',
      senderId: env.SMS_SENDER_ID ?? '',
      peId: env.SMS_PE_ID ?? '',
      otpTemplateId: env.SMS_OTP_TEMPLATE_ID ?? '',
      eventTemplateId: env.SMS_EVENT_TEMPLATE_ID,
      eventRoute: env.SMS_EVENT_ROUTE,
      eventLink: env.SMS_EVENT_LINK ?? `${env.PUBLIC_WEB_URL}/brochures`,
      textUrl: env.SMS_TEXT_URL,
      otpUrl: env.SMS_OTP_URL,
    },
    storage: {
      driver: env.STORAGE_DRIVER,
      localRoot: env.STORAGE_LOCAL_ROOT,
      localDurable: env.STORAGE_LOCAL_DURABLE,
      scannerMode: env.FILE_SCANNER_MODE,
      clamav: {
        host: env.CLAMAV_HOST,
        port: env.CLAMAV_PORT,
        timeoutMs: env.CLAMAV_TIMEOUT_MS,
      },
    },
    speech: {
      provider: env.SPEECH_PROVIDER,
      timeoutMs: env.SPEECH_TIMEOUT_MS,
      sarvam: {
        apiKey: env.SARVAM_API_KEY,
        model: env.SARVAM_STT_MODEL,
        endpoint: env.SARVAM_STT_URL,
      },
    },
    geocoding: {
      provider: env.GEOCODER,
      timeoutMs: env.GEOCODER_TIMEOUT_MS,
      mappls: {
        clientId: env.MAPPLS_CLIENT_ID,
        clientSecret: env.MAPPLS_CLIENT_SECRET,
        tokenUrl: env.MAPPLS_TOKEN_URL,
        reverseUrl: env.MAPPLS_REVERSE_URL,
      },
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
