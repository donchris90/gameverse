import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { type MatchView, matchIdSchema, moveSchema } from '@gameverse/shared-types';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MatchesService } from './matches.service.js';

const idParam = () => Param('id', new ZodValidationPipe(matchIdSchema));

@Controller('matches')
@UseGuards(JwtAuthGuard)
export class MatchesController {
  constructor(private readonly matches: MatchesService) {}

  /** The match the caller is in right now, so a restarted app can resume it. */
  @Get('current')
  current(@CurrentUser() user: AuthUser): Promise<{ match: MatchView | null }> {
    return this.matches.current(user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @idParam() id: string): Promise<MatchView> {
    return this.matches.get(user.id, id);
  }

  @Post(':id/ready')
  @HttpCode(HttpStatus.OK)
  ready(@CurrentUser() user: AuthUser, @idParam() id: string): Promise<MatchView> {
    return this.matches.ready(user.id, id);
  }

  @Post(':id/moves')
  @HttpCode(HttpStatus.OK)
  move(
    @CurrentUser() user: AuthUser,
    @idParam() id: string,
    @Body(new ZodValidationPipe(moveSchema)) body: z.output<typeof moveSchema>,
  ): Promise<MatchView> {
    return this.matches.move(user.id, id, body);
  }

  @Post(':id/leave')
  @HttpCode(HttpStatus.OK)
  leave(@CurrentUser() user: AuthUser, @idParam() id: string): Promise<MatchView> {
    return this.matches.leave(user.id, id);
  }

  @Post(':id/rematch')
  @HttpCode(HttpStatus.OK)
  rematch(@CurrentUser() user: AuthUser, @idParam() id: string): Promise<MatchView> {
    return this.matches.rematch(user.id, id);
  }
}
