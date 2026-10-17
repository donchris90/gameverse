import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const GOOD_SECRET = 'k7Qm2VxR9tLp4WzN8bYc1JhD6sFg3AeU5oIv0XnT';

const baseEnv = {
  DATABASE_URL: 'postgresql://user:pw@localhost:5432/db',
  JWT_ACCESS_SECRET: GOOD_SECRET,
};

function errorMessageFor(env: Record<string, string | undefined>): string {
  try {
    loadConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as Error).message;
  }
  throw new Error('expected loadConfig to throw');
}

describe('loadConfig', () => {
  it('applies safe defaults', () => {
    const config = loadConfig(baseEnv);
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      TRUST_PROXY: false,
      ACCESS_TOKEN_TTL_SECONDS: 900,
      REFRESH_TOKEN_TTL_DAYS: 30,
      EMAIL_PROVIDER: 'console',
      GOOGLE_CLIENT_IDS: [],
      APPLE_CLIENT_IDS: [],
      CORS_ORIGINS: [],
    });
  });

  it('parses numbers, booleans and comma-separated lists', () => {
    const config = loadConfig({
      ...baseEnv,
      PORT: '8080',
      TRUST_PROXY: 'true',
      GOOGLE_CLIENT_IDS: ' a.apps.test , b.apps.test ,, ',
      CORS_ORIGINS: 'https://a.test,https://b.test',
    });
    expect(config.PORT).toBe(8080);
    expect(config.TRUST_PROXY).toBe(true);
    expect(config.GOOGLE_CLIENT_IDS).toEqual(['a.apps.test', 'b.apps.test']);
    expect(config.CORS_ORIGINS).toEqual(['https://a.test', 'https://b.test']);
  });

  it('names every missing required variable', () => {
    const message = errorMessageFor({});
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('JWT_ACCESS_SECRET');
  });

  it('rejects out-of-range values', () => {
    expect(errorMessageFor({ ...baseEnv, PORT: '70000' })).toContain('PORT');
    expect(errorMessageFor({ ...baseEnv, ACCESS_TOKEN_TTL_SECONDS: '5' })).toContain(
      'ACCESS_TOKEN_TTL_SECONDS',
    );
    expect(errorMessageFor({ ...baseEnv, TRUST_PROXY: 'yes' })).toContain('TRUST_PROXY');
    expect(errorMessageFor({ ...baseEnv, NODE_ENV: 'prod' })).toContain('NODE_ENV');
  });

  it('rejects short and placeholder JWT secrets', () => {
    expect(errorMessageFor({ ...baseEnv, JWT_ACCESS_SECRET: 'too-short' })).toContain(
      'JWT_ACCESS_SECRET',
    );
    expect(
      errorMessageFor({
        ...baseEnv,
        JWT_ACCESS_SECRET: 'REPLACE_WITH_A_LONG_RANDOM_SECRET_AT_LEAST_32_CHARS',
      }),
    ).toContain('placeholder');
  });

  it('never echoes secret values in error messages', () => {
    const secretish = 'my-super-secret-value-that-must-not-leak-1234567890';
    const message = errorMessageFor({
      DATABASE_URL: 'postgresql://admin:hunter2-password@db.internal:5432/prod',
      JWT_ACCESS_SECRET: secretish,
      PORT: 'not-a-number',
    });
    expect(message).not.toContain(secretish);
    expect(message).not.toContain('hunter2-password');
  });

  describe('staging and production', () => {
    const deployed = {
      ...baseEnv,
      NODE_ENV: 'production',
      PUBLIC_WEB_URL: 'https://gameverse.test',
    };

    it('refuses to start with a development email provider', () => {
      expect(errorMessageFor({ ...deployed, EMAIL_PROVIDER: 'console' })).toContain(
        'EMAIL_PROVIDER',
      );
      expect(errorMessageFor({ ...deployed, EMAIL_PROVIDER: 'memory' })).toContain(
        'EMAIL_PROVIDER',
      );
      expect(errorMessageFor({ ...deployed, NODE_ENV: 'staging' })).toContain('EMAIL_PROVIDER');
    });

    it('refuses the fake voice provider', () => {
      expect(errorMessageFor({ ...deployed, VOICE_PROVIDER: 'fake' })).toContain('VOICE_PROVIDER');
      expect(
        errorMessageFor({ ...deployed, NODE_ENV: 'staging', VOICE_PROVIDER: 'fake' }),
      ).toContain('VOICE_PROVIDER');
    });

    it('requires an API key and a real sender when using the resend provider', () => {
      const resend = {
        ...deployed,
        EMAIL_PROVIDER: 'resend',
        EMAIL_FROM: 'GameVerse <no-reply@gameverse.test>',
      };
      expect(errorMessageFor(resend)).toContain('RESEND_API_KEY');
      expect(
        errorMessageFor({
          ...resend,
          RESEND_API_KEY: 're_test_key',
          EMAIL_FROM: 'a <b@example.invalid>',
        }),
      ).toContain('EMAIL_FROM');
      expect(() => loadConfig({ ...resend, RESEND_API_KEY: 're_test_key' })).not.toThrow();
    });

    it('rejects wildcard CORS and non-https public URLs', () => {
      expect(errorMessageFor({ ...deployed, CORS_ORIGINS: '*' })).toContain('CORS_ORIGINS');
      expect(errorMessageFor({ ...deployed, PUBLIC_WEB_URL: 'http://gameverse.test' })).toContain(
        'PUBLIC_WEB_URL',
      );
    });

    it('still allows the same development values in development and test', () => {
      expect(() => loadConfig({ ...baseEnv, NODE_ENV: 'development' })).not.toThrow();
      expect(() =>
        loadConfig({ ...baseEnv, NODE_ENV: 'test', EMAIL_PROVIDER: 'memory' }),
      ).not.toThrow();
    });
  });
});
