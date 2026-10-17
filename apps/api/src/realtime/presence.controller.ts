import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { type PresenceEntry, presenceQuerySchema } from '@gameverse/shared-types';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { PresenceService } from './presence.service.js';

@Controller('presence')
@UseGuards(JwtAuthGuard)
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  /** POST because the id list is a body; it changes nothing. */
  @Post('query')
  @HttpCode(HttpStatus.OK)
  query(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(presenceQuerySchema)) body: z.output<typeof presenceQuerySchema>,
  ): Promise<PresenceEntry[]> {
    return this.presence.query(user.id, body.userIds);
  }
}
