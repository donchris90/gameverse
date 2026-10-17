import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole, UserStatus } from '@gameverse/shared-types';
import { mayActOn, nextStatus, type ActionType } from './moderation.service.js';
import { Roles } from './roles.decorator.js';
import { RolesGuard } from './roles.guard.js';

describe('mayActOn', () => {
  const roles: UserRole[] = ['USER', 'MODERATOR', 'ADMIN'];
  const expected: Record<string, boolean> = {
    'USER>USER': false,
    'USER>MODERATOR': false,
    'USER>ADMIN': false,
    'MODERATOR>USER': true,
    'MODERATOR>MODERATOR': false,
    'MODERATOR>ADMIN': false,
    'ADMIN>USER': true,
    'ADMIN>MODERATOR': true,
    'ADMIN>ADMIN': false,
  };
  for (const actor of roles) {
    for (const target of roles) {
      it(`${actor} acting on ${target} -> ${String(expected[`${actor}>${target}`])}`, () => {
        expect(mayActOn(actor, target)).toBe(expected[`${actor}>${target}`]);
      });
    }
  }
});

describe('nextStatus', () => {
  const statuses: UserStatus[] = ['ACTIVE', 'SUSPENDED', 'BANNED', 'PENDING_DELETION', 'DELETED'];
  const table: Record<ActionType, Record<UserStatus, UserStatus | null | 'INVALID'>> = {
    BAN: {
      ACTIVE: 'BANNED',
      SUSPENDED: 'BANNED',
      BANNED: null,
      PENDING_DELETION: 'INVALID',
      DELETED: 'INVALID',
    },
    SUSPEND: {
      ACTIVE: 'SUSPENDED',
      SUSPENDED: null,
      BANNED: 'INVALID',
      PENDING_DELETION: 'INVALID',
      DELETED: 'INVALID',
    },
    REINSTATE: {
      ACTIVE: null,
      SUSPENDED: 'ACTIVE',
      BANNED: 'ACTIVE',
      PENDING_DELETION: 'INVALID',
      DELETED: 'INVALID',
    },
  };
  for (const type of Object.keys(table) as ActionType[]) {
    for (const status of statuses) {
      const want = table[type][status];
      it(`${type} on ${status} -> ${String(want)}`, () => {
        if (want === 'INVALID') expect(() => nextStatus(type, status)).toThrow();
        else expect(nextStatus(type, status)).toBe(want);
      });
    }
  }
});

describe('RolesGuard', () => {
  function contextFor(target: object, handlerName: string, role: UserRole): ExecutionContext {
    const instance = target as Record<string, () => void>;
    return {
      getHandler: () => instance[handlerName],
      getClass: () => (target as { constructor: new () => object }).constructor,
      switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
    } as unknown as ExecutionContext;
  }

  class Open {
    plain(): void {}
    @Roles('ADMIN')
    adminOnly(): void {}
  }
  @Roles('MODERATOR', 'ADMIN')
  class Staff {
    staff(): void {}
    @Roles('ADMIN')
    adminOnly(): void {}
  }

  const guard = new RolesGuard(new Reflector());

  it('fails closed when a guarded route declares no roles', () => {
    expect(() => guard.canActivate(contextFor(new Open(), 'plain', 'ADMIN'))).toThrow();
  });

  it('applies method-level roles over class-level roles', () => {
    expect(guard.canActivate(contextFor(new Staff(), 'staff', 'MODERATOR'))).toBe(true);
    expect(() => guard.canActivate(contextFor(new Staff(), 'adminOnly', 'MODERATOR'))).toThrow();
    expect(guard.canActivate(contextFor(new Staff(), 'adminOnly', 'ADMIN'))).toBe(true);
    expect(() => guard.canActivate(contextFor(new Open(), 'adminOnly', 'USER'))).toThrow();
  });
});
