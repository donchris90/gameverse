import { Body, Controller, HttpCode, HttpStatus, Inject, Post, UseGuards } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ErrorCode } from '@gameverse/shared-types';
import { z } from 'zod';
import { AppException } from '../common/app.exception.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { VoiceNotConfiguredError, VoiceProvider } from './voice.provider.js';

/** Spike channels are namespaced so they can never collide with real match channels. */
export const spikeTokenSchema = z.object({
  channel: z.string().regex(/^spike-[a-z0-9-]{3,32}$/, 'must look like "spike-<name>"'),
});
type SpikeTokenBody = z.output<typeof spikeTokenSchema>;

/** Stable, non-zero uint32 derived from the account id. The real uid mapping arrives in Phase 3. */
export function agoraUidFor(userId: string): number {
  const value = createHash('sha256').update(userId).digest().readUInt32BE(0);
  return value === 0 ? 1 : value;
}

/**
 * Phase 0 only: lets the two-phone spike obtain a token for a "spike-" channel. Returns 404 unless
 * VOICE_SPIKE_ENABLED=true (never allowed in staging/production). Match-bound tokens with
 * membership checks replace this in Phase 3.
 */
@Controller('voice/spike')
@UseGuards(JwtAuthGuard)
export class VoiceSpikeController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly voice: VoiceProvider,
  ) {}

  @Post('token')
  @HttpCode(HttpStatus.OK)
  token(
    @Body(new ZodValidationPipe(spikeTokenSchema)) body: SpikeTokenBody,
    @CurrentUser() user: AuthUser,
  ): { appId: string; channel: string; uid: number; token: string; expiresAt: string } {
    if (!this.config.VOICE_SPIKE_ENABLED) {
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Not found');
    }
    try {
      const grant = this.voice.issueToken({
        channel: body.channel,
        uid: agoraUidFor(user.id),
        ttlSeconds: this.config.VOICE_TOKEN_TTL_SECONDS,
      });
      return { ...grant, expiresAt: grant.expiresAt.toISOString() };
    } catch (error) {
      if (error instanceof VoiceNotConfiguredError) {
        throw new AppException(
          HttpStatus.SERVICE_UNAVAILABLE,
          ErrorCode.SERVICE_UNAVAILABLE,
          'Voice is not available',
        );
      }
      throw error;
    }
  }
}
