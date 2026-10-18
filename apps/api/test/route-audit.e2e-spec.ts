import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectRoutes, type AuditedRoute } from './helpers/routes.js';
import { createTestApp, type TestApp } from './helpers/test-app.js';

/** Routes that are public by design. Adding a route here is a security review decision. */
const PUBLIC_ROUTES = [
  'GET /health/live',
  'GET /health/ready',
  'GET /verify-email',
  'GET /reset-password',
  'GET /delete-account',
  'POST /v1/auth/forgot-password',
  'POST /v1/auth/login',
  'POST /v1/auth/logout', // credential is the refresh token in the body
  'POST /v1/auth/refresh',
  'POST /v1/auth/register',
  'POST /v1/auth/reset-password',
  'POST /v1/auth/social',
  'POST /v1/auth/verify-email',
].sort();

describe('route audit', () => {
  let t: TestApp;
  let routes: AuditedRoute[];
  beforeAll(async () => {
    t = await createTestApp();
    routes = collectRoutes(t);
  });
  afterAll(async () => {
    await t.close();
  });

  const key = (r: AuditedRoute) => `${r.method} ${r.path}`;
  const isProtected = (r: AuditedRoute) => r.guards.includes('JwtAuthGuard');

  it('finds the whole API surface', () => {
    expect(routes.length).toBeGreaterThan(70);
  });

  it('exposes exactly the reviewed public routes without authentication', () => {
    const open = routes
      .filter((r) => !isProtected(r))
      .map(key)
      .sort();
    expect(open).toEqual(PUBLIC_ROUTES);
  });

  it('puts every admin route behind the role guard', () => {
    const admin = routes.filter((r) => r.path.startsWith('/v1/admin/'));
    expect(admin.length).toBeGreaterThan(5);
    for (const route of admin) expect(route.guards, key(route)).toContain('RolesGuard');
  });

  it('rejects an anonymous request on every protected route with 401', async () => {
    const protectedRoutes = routes.filter(isProtected);
    expect(protectedRoutes.length).toBeGreaterThan(60);
    for (const route of protectedRoutes) {
      const url = route.path.replace(/:\w+/g, '00000000-0000-4000-8000-000000000000');
      const res = await request(t.server)[route.method.toLowerCase() as 'get'](url).send({});
      expect(res.status, key(route)).toBe(401);
    }
  });

  it('rejects a garbage bearer token on every protected route with 401', async () => {
    for (const route of routes.filter(isProtected)) {
      const url = route.path.replace(/:\w+/g, '00000000-0000-4000-8000-000000000000');
      const res = await request(t.server)
        [route.method.toLowerCase() as 'get'](url)
        .set('Authorization', 'Bearer not.a.jwt')
        .send({});
      expect(res.status, key(route)).toBe(401);
    }
  });
});
