import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/config.js';
import { agoraUidFor } from './voice-spike.controller.js';
import { AgoraVoiceProvider, VoiceNotConfiguredError } from './voice.provider.js';

const APP_ID = '0123456789abcdef0123456789abcdef';
const CERTIFICATE = 'fedcba9876543210fedcba9876543210';

function providerWith(extra: Record<string, string>): AgoraVoiceProvider {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://localhost/unused_test',
    JWT_ACCESS_SECRET: 'k7Qm2VxR9tLp4WzN8bYc1JhD6sFg3AeU5oIv0XnT',
    ...extra,
  });
  return new AgoraVoiceProvider(config);
}

function decodedBody(token: string): string {
  return inflateSync(Buffer.from(token.slice(3), 'base64')).toString('latin1');
}

describe('AgoraVoiceProvider', () => {
  const now = new Date('2026-10-17T10:00:00.000Z');

  it('builds a version-007 token for the requested channel and never embeds the certificate', () => {
    const provider = providerWith({ AGORA_APP_ID: APP_ID, AGORA_APP_CERTIFICATE: CERTIFICATE });
    const grant = provider.issueToken({ channel: 'spike-room', uid: 42, ttlSeconds: 600 }, now);

    expect(grant.token.startsWith('007')).toBe(true);
    const body = decodedBody(grant.token);
    expect(body).toContain(APP_ID);
    expect(body).toContain('spike-room');
    expect(body).not.toContain(CERTIFICATE);
    expect(grant).toMatchObject({ appId: APP_ID, channel: 'spike-room', uid: 42 });
    expect(grant.expiresAt.toISOString()).toBe('2026-10-17T10:10:00.000Z');
  });

  it('issues different tokens for different users and channels', () => {
    const provider = providerWith({ AGORA_APP_ID: APP_ID, AGORA_APP_CERTIFICATE: CERTIFICATE });
    const a = provider.issueToken({ channel: 'spike-room', uid: 1, ttlSeconds: 600 }, now);
    const b = provider.issueToken({ channel: 'spike-room', uid: 2, ttlSeconds: 600 }, now);
    const c = provider.issueToken({ channel: 'spike-other', uid: 1, ttlSeconds: 600 }, now);
    expect(new Set([a.token, b.token, c.token]).size).toBe(3);
  });

  it.each([
    ['no credentials', {}],
    ['app id only', { AGORA_APP_ID: APP_ID }],
    ['certificate only', { AGORA_APP_CERTIFICATE: CERTIFICATE }],
  ])('refuses to issue a token with %s', (_name, env) => {
    expect(() =>
      providerWith(env).issueToken({ channel: 'spike-room', uid: 1, ttlSeconds: 600 }, now),
    ).toThrow(VoiceNotConfiguredError);
  });
});

describe('agoraUidFor', () => {
  it('is stable, non-zero and a valid uint32', () => {
    const id = '0198a000-0000-7000-8000-000000000001';
    expect(agoraUidFor(id)).toBe(agoraUidFor(id));
    expect(agoraUidFor(id)).toBeGreaterThan(0);
    expect(agoraUidFor(id)).toBeLessThanOrEqual(0xffffffff);
    expect(agoraUidFor(id)).not.toBe(agoraUidFor('0198a000-0000-7000-8000-000000000002'));
  });
});

describe('config guards', () => {
  it('refuses the spike endpoint in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://localhost/x',
        JWT_ACCESS_SECRET: 'k7Qm2VxR9tLp4WzN8bYc1JhD6sFg3AeU5oIv0XnT',
        PUBLIC_WEB_URL: 'https://gameverse.example.org',
        VOICE_SPIKE_ENABLED: 'true',
      }),
    ).toThrow(/VOICE_SPIKE_ENABLED/);
  });
});
