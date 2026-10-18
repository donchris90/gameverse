import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/test-app.js';

interface AuditedRoute {
  method: string;
  path: string;
  guards: string[];
}

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

const UNPREFIXED = new Set([
  'GET /health/live',
  'GET /health/ready',
  'GET /verify-email',
  'GET /reset-password',
  'GET /delete-account',
]);

const join = (...parts: string[]) =>
  '/' +
  parts
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');

/** Every HTTP route the API exposes, with the guards that protect it (class and method level). */
function collectRoutes(t: TestApp): AuditedRoute[] {
  const routes: AuditedRoute[] = [];
  for (const module of t.app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype;
      if (!controller) continue;
      const prefix = Reflect.getMetadata(PATH_METADATA, controller) as string | string[];
      const classGuards = (Reflect.getMetadata(GUARDS_METADATA, controller) ?? []) as {
        name: string;
      }[];
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = (controller.prototype as Record<string, unknown>)[name];
        if (typeof handler !== 'function') continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (method === undefined) continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string | string[];
        const methodGuards = (Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as {
          name: string;
        }[];
        routes.push({
          method: RequestMethod[method] ?? String(method),
          path: join(
            UNPREFIXED.has(
              `${RequestMethod[method]} ${join([prefix].flat()[0] ?? '', [path].flat()[0] ?? '')}`,
            )
              ? ''
              : '/v1',
            [prefix].flat()[0] ?? '',
            [path].flat()[0] ?? '',
          ),
          guards: [...classGuards, ...methodGuards].map((guard) => guard.name),
        });
      }
    }
  }
  return routes.sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
}

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
