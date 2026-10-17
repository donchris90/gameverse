import { Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { matchIdSchema, type VoiceSessionView, type VoiceTokenView } from '@gameverse/shared-types';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { VoiceService } from './voice.service.js';

const matchId = () => Param('id', new ZodValidationPipe(matchIdSchema));

/** Voice for one match. Every route is for seated players only. */
@Controller('matches/:id/voice')
@UseGuards(JwtAuthGuard)
export class VoiceController {
  constructor(private readonly voice: VoiceService) {}

  /** Issues (or renews) a short-lived channel token. */
  @Post('token')
  @HttpCode(HttpStatus.OK)
  token(@CurrentUser() user: AuthUser, @matchId() id: string): Promise<VoiceTokenView> {
    return this.voice.token(user.id, id);
  }

  @Post('joined')
  @HttpCode(HttpStatus.OK)
  joined(@CurrentUser() user: AuthUser, @matchId() id: string): Promise<VoiceSessionView> {
    return this.voice.joined(user.id, id);
  }

  @Post('left')
  @HttpCode(HttpStatus.OK)
  left(@CurrentUser() user: AuthUser, @matchId() id: string): Promise<{ closed: number }> {
    return this.voice.left(user.id, id);
  }
}
