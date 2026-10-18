import { z } from 'zod';

/** DI token for the validated application configuration. */
export const APP_CONFIG = Symbol('APP_CONFIG');

const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const PLACEHOLDER_SECRET = /replace_with|change[-_]?me|placeholder|example|secret_here/i;

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    TRUST_PROXY: booleanString,

    DATABASE_URL: z.string().min(1, 'is required'),

    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),

    GOOGLE_CLIENT_IDS: csv,
    APPLE_CLIENT_IDS: csv,

    PUBLIC_WEB_URL: z.url().default('http://localhost:3000'),
    CORS_ORIGINS: csv,

    /** console / memory are development and test stubs. resend sends real email over HTTPS. */
    EMAIL_PROVIDER: z.enum(['console', 'memory', 'resend']).default('console'),
    EMAIL_FROM: z.string().min(3).default('GameVerse <no-reply@example.invalid>'),
    RESEND_API_KEY: z.string().trim().optional(),
    RESEND_API_URL: z.url().default('https://api.resend.com/emails'),

    AGORA_APP_ID: z.string().trim().optional(),
    AGORA_APP_CERTIFICATE: z.string().trim().optional(),
    /** agora = real tokens. fake = deterministic tokens for tests and local development only. */
    VOICE_PROVIDER: z.enum(['agora', 'fake']).default('agora'),
    /** Lifetime of a match voice token; the app renews it before it expires. */
    VOICE_MATCH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
    VOICE_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(3600),
    /** Enables the Phase 0 voice spike token endpoint. Development and test only. */
    VOICE_SPIKE_ENABLED: booleanString,

    /** none = push disabled (nothing is sent). memory = tests only. expo = Expo push service. */
    PUSH_PROVIDER: z.enum(['none', 'expo', 'memory']).default('none'),
    EXPO_PUSH_URL: z.url().default('https://exp.host/--/api/v2/push/send'),
    EXPO_ACCESS_TOKEN: z.string().trim().optional(),
    /** How long a user must stay disconnected before friends are told they went offline. */
    PRESENCE_OFFLINE_GRACE_MS: z.coerce.number().int().min(0).max(60_000).default(5000),

    /** Sentry error reporting. Off unless a DSN is set. Events are scrubbed before sending. */
    SENTRY_DSN: z
      .url()
      .optional()
      .or(z.literal('').transform(() => undefined)),
    SENTRY_ENVIRONMENT: z.string().trim().min(1).optional(),
    SENTRY_RELEASE: z.string().trim().min(1).optional(),

    RATE_LIMIT_DEFAULT_PER_MIN: z.coerce.number().int().min(1).max(100_000).default(120),
    RATE_LIMIT_AUTH_PER_MIN: z.coerce.number().int().min(1).max(10_000).default(10),
  })
  .superRefine((config, ctx) => {
    if (PLACEHOLDER_SECRET.test(config.JWT_ACCESS_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_ACCESS_SECRET'],
        message: 'looks like a placeholder; generate a real random secret',
      });
    }

    const deployed = config.NODE_ENV === 'staging' || config.NODE_ENV === 'production';
    if (deployed) {
      // The console and memory providers print or drop verification and reset links, so a
      // deployed server must use a real provider with a real sender address.
      if (config.EMAIL_PROVIDER !== 'resend') {
        ctx.addIssue({
          code: 'custom',
          path: ['EMAIL_PROVIDER'],
          message: 'development email providers are not allowed in staging/production; use resend',
        });
      } else {
        if (!config.RESEND_API_KEY) {
          ctx.addIssue({
            code: 'custom',
            path: ['RESEND_API_KEY'],
            message: 'required when EMAIL_PROVIDER=resend',
          });
        }
        if (config.EMAIL_FROM.includes('example.invalid')) {
          ctx.addIssue({
            code: 'custom',
            path: ['EMAIL_FROM'],
            message: 'set a real sender address on a domain verified with the email provider',
          });
        }
      }
      if (config.PUSH_PROVIDER === 'memory') {
        ctx.addIssue({
          code: 'custom',
          path: ['PUSH_PROVIDER'],
          message: 'the in-memory push provider is for tests only',
        });
      }
      if (config.VOICE_PROVIDER === 'fake') {
        ctx.addIssue({
          code: 'custom',
          path: ['VOICE_PROVIDER'],
          message: 'the fake voice provider is for tests and local development only',
        });
      }
      if (config.VOICE_SPIKE_ENABLED) {
        ctx.addIssue({
          code: 'custom',
          path: ['VOICE_SPIKE_ENABLED'],
          message: 'the voice spike endpoint is not allowed in staging/production',
        });
      }
      if (config.CORS_ORIGINS.includes('*')) {
        ctx.addIssue({
          code: 'custom',
          path: ['CORS_ORIGINS'],
          message: 'wildcard origins are not allowed in staging/production',
        });
      }
      if (!config.PUBLIC_WEB_URL.startsWith('https://')) {
        ctx.addIssue({
          code: 'custom',
          path: ['PUBLIC_WEB_URL'],
          message: 'must use https in staging/production',
        });
      }
    }
  });

export type AppConfig = z.output<typeof envSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Validates environment variables. Error messages name the offending variables but never echo
 * their values, so secrets cannot leak into logs.
 */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new ConfigError(`Invalid environment configuration - ${problems}`);
  }
  return result.data;
}
