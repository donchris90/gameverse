import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerUser, tokenFromLastEmail } from './helpers/factories.js';
import { createTestApp, type TestApp } from './helpers/test-app.js';

describe('email link landing pages', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  const paths = ['verify-email', 'reset-password', 'delete-account'] as const;

  it.each(paths)(
    '%s hands a well-formed token to the app and is not cached or indexed',
    async (path) => {
      const token = 'A'.repeat(43);
      const response = await request(t.server).get(`/${path}`).query({ token }).expect(200);
      expect(response.text).toContain(`href="gameverse://${path}?token=${token}"`);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['x-robots-tag']).toContain('noindex');
      expect(response.headers['content-security-policy']).toContain("default-src 'none'");
      expect(response.headers['content-type']).toContain('text/html');
    },
  );

  it.each(paths)(
    '%s refuses missing, short and markup-bearing tokens without echoing them',
    async (path) => {
      await request(t.server).get(`/${path}`).expect(400);
      await request(t.server).get(`/${path}`).query({ token: 'short' }).expect(400);
      const attack = '"><script>alert(1)</script>aaaaaaaaaaaaaaaaaaaa';
      const response = await request(t.server).get(`/${path}`).query({ token: attack }).expect(400);
      expect(response.text).not.toContain('<script>');
      expect(response.text).not.toContain('alert(1)');
      await request(t.server)
        .get(`/${path}`)
        .query({ token: ['a'.repeat(30), 'b'.repeat(30)] })
        .expect(400);
    },
  );

  it('the real link in a verification email leads to a working landing page', async () => {
    const user = await registerUser(t);
    const token = tokenFromLastEmail(t, user.email);
    const link = new URL(t.email.last(user.email)?.text.match(/https?:\/\/\S+/)?.[0] ?? '');
    expect(link.pathname).toBe('/verify-email');
    const response = await request(t.server).get(`${link.pathname}${link.search}`).expect(200);
    expect(response.text).toContain(`gameverse://verify-email?token=${token}`);
  });
});
