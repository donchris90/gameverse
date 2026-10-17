import { Controller, Get, UseGuards } from '@nestjs/common';
import type { AccountView } from '@gameverse/shared-types';
import { type AuthUser } from '../auth/auth.types.js';
import { toAccountView } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('me')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  /** The signed-in account. Exposes only the safe AccountView: never DOB, hashes or tokens. */
  @Get()
  async me(@CurrentUser() user: AuthUser): Promise<AccountView> {
    const account = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    return toAccountView(account);
  }
}
