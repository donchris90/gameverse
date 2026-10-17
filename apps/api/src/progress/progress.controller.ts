import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  leaderboardParamSchema,
  leaderboardQuerySchema,
  type GameId,
  type LeaderboardQuery,
  type LeaderboardView,
  type MyProgress,
} from '@gameverse/shared-types';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ProgressService } from './progress.service.js';

@Controller()
@UseGuards(JwtAuthGuard)
export class ProgressController {
  constructor(private readonly progress: ProgressService) {}

  @Get('me/progress')
  mine(@CurrentUser() user: AuthUser): Promise<MyProgress> {
    return this.progress.mine(user.id);
  }

  @Get('leaderboards/:gameId')
  leaderboard(
    @CurrentUser() user: AuthUser,
    @Param('gameId', new ZodValidationPipe(leaderboardParamSchema)) gameId: GameId,
    @Query(new ZodValidationPipe(leaderboardQuerySchema)) query: LeaderboardQuery,
  ): Promise<LeaderboardView> {
    return this.progress.leaderboard(user.id, gameId, query);
  }
}
