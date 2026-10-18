import { describe, expect, it } from 'vitest';
import { scrubEvent, scrubText, type ScrubbableEvent } from './scrub.js';

const JWT =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1rwW1gFWFOEjXk';

describe('scrubText', () => {
  it('removes emails, JWTs, bearer tokens and long opaque tokens', () => {
    const out = scrubText(
      `user jude@example.com sent ${JWT} with Bearer abc.def-ghi and refresh ${'A1b2C3d4'.repeat(6)}`,
    );
    expect(out).not.toContain('jude@example.com');
    expect(out).not.toContain('eyJ');
    expect(out).not.toContain('abc.def-ghi');
    expect(out).not.toMatch(/A1b2C3d4A1b2C3d4/);
    expect(out).toContain('[email]');
  });

  it('leaves ordinary text alone', () => {
    expect(scrubText('Match not found')).toBe('Match not found');
  });
});

describe('scrubEvent', () => {
  // Real events carry far more than the typed subset; the fixture does too, hence the cast.
  const event = (): ScrubbableEvent & Record<string, unknown> =>
    ({
      message: 'failed for jude@example.com',
      server_name: 'render-host-1',
      request: {
        method: 'POST',
        url: 'https://api.example.com/v1/auth/login?token=secretsecretsecretsecretsecretsecretsecret',
        headers: { authorization: `Bearer ${JWT}`, cookie: 'a=b' },
        cookies: { a: 'b' },
        data: { email: 'jude@example.com', password: 'hunter2' },
        query_string: 'token=abc',
      },
      user: { id: 'u1', email: 'jude@example.com', ip_address: '1.2.3.4', username: 'jude' },
      exception: { values: [{ type: 'Error', value: `bad token ${JWT}` }] },
      breadcrumbs: [{ message: 'login jude@example.com', data: { body: 'password=hunter2' } }],
      extra: { note: 'jude@example.com', blob: { password: 'hunter2' } },
    }) as unknown as ScrubbableEvent & Record<string, unknown>;

  it('keeps only what is needed to debug: stack, route, method, account id', () => {
    const out = scrubEvent(event());
    expect(out.request).toEqual({ method: 'POST', url: 'https://api.example.com/v1/auth/login' });
    expect(out.user).toEqual({ id: 'u1' });
    expect(out.server_name).toBeUndefined();
    expect(out.breadcrumbs?.[0]?.data).toBeUndefined();
    expect(out['extra']).toEqual({ note: '[email]', blob: '[removed]' });
  });

  it('leaves no secret anywhere in the serialized event', () => {
    const text = JSON.stringify(scrubEvent(event()));
    for (const secret of [
      'jude@example.com',
      'hunter2',
      'eyJ',
      '1.2.3.4',
      'secretsecret',
      'cookie',
    ]) {
      expect(text, secret).not.toContain(secret);
    }
  });
});
