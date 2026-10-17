import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, type UserRole } from '@gameverse/shared-types';
import { AppException } from '../common/app.exception.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { ROLES_KEY } from './roles.decorator.js';

/**
 * Fails closed: a route that uses this guard without any @Roles metadata is refused, so forgetting
 * the decorator can never expose staff endpoints. The role comes from the database (JwtAuthGuard),
 * not from the token.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!allowed || allowed.length === 0 || !allowed.includes(request.user.role)) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.INSUFFICIENT_ROLE,
        'You do not have permission to do this',
      );
    }
    return true;
  }
}
