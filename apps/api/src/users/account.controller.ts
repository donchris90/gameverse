import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { type MessageResponse, confirmDeletionSchema } from '@gameverse/shared-types';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AccountService } from './account.service.js';

@Controller('me/deletion')
@UseGuards(JwtAuthGuard)
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Post('request')
  @HttpCode(HttpStatus.ACCEPTED)
  request(@CurrentUser() user: AuthUser): Promise<MessageResponse> {
    return this.account.requestDeletion(user.id);
  }

  @Post('confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  confirm(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(confirmDeletionSchema))
    body: z.output<typeof confirmDeletionSchema>,
  ): Promise<void> {
    return this.account.confirmDeletion(user.id, body.token);
  }
}
