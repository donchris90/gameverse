import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@gameverse/shared-types';

export const ROLES_KEY = 'roles';
/** Restricts a route (or controller) to the listed roles. Use together with JwtAuthGuard. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
