import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import type { TestApp } from './test-app.js';

export interface AuditedRoute {
  method: string;
  path: string;
  guards: string[];
}

const UNPREFIXED = new Set([
  'GET /health/live',
  'GET /health/ready',
  'GET /verify-email',
  'GET /reset-password',
  'GET /delete-account',
  'POST /delete-account',
  'GET /account-deletion',
  'POST /account-deletion',
]);

const join = (...parts: string[]) =>
  '/' +
  parts
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');

/** Every HTTP route the API exposes, with the guards that protect it (class and method level). */
export function collectRoutes(t: TestApp): AuditedRoute[] {
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
