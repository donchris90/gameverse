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
import {
  type MatchView,
  ayoEndSchema,
  ayoMoveSchema,
  botMatchSchema,
  draughtsMoveSchema,
  matchIdSchema,
  moveSchema,
  rollSchema,
  tokenMoveSchema,
} from '@gameverse/shared-types';
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

  /** Practice match against a labelled bot. */
  @Post('bot')
  startBot(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(botMatchSchema)) body: z.output<typeof botMatchSchema>,
  ): Promise<MatchView> {
    return this.matches.startBotMatch(
      user.id,
      body.gameId,
      body.level,
      body.players,
      body.bestOf ?? 3,
    );
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

  /** Ludo: the server rolls the die. */
  @Post(':id/roll')
  @HttpCode(HttpStatus.OK)
  roll(
    @CurrentUser() user: AuthUser,
    @idParam() id: string,
    @Body(new ZodValidationPipe(rollSchema)) body: z.output<typeof rollSchema>,
  ): Promise<MatchView> {
    return this.matches.roll(user.id, id, body);
  }

  /** Ludo: take your seat back from the AI that was playing it while you were away. */
  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  resume(
    @CurrentUser() user: AuthUser,
    @idParam() id: string,
    @Body(new ZodValidationPipe(rollSchema)) body: z.output<typeof rollSchema>,
  ): Promise<MatchView> {
    return this.matches.resume(user.id, id, body);
  }

  /** Ludo: move a token by the die that was rolled. */
  @Post(':id/token-moves')
  @HttpCode(HttpStatus.OK)
  moveToken(
    @CurrentUser() user: AuthUser,
    @idParam() id: string,
    @Body(new ZodValidationPipe(tokenMoveSchema)) body: z.output<typeof tokenMoveSchema>,
  ): Promise<MatchView> {
    return this.matches.moveToken(user.id, id, body);
  }

  /** Draughts: play a move given as squares. */
  @Post(':id/draughts-moves')
  @HttpCode(HttpStatus.OK)
  moveDraughts(
    @CurrentUser() user: AuthUser,
    @idParam() id: string,
    @Body(new ZodValidationPipe(draughtsMoveSchema)) body: z.output<typeof draughtsMoveSchema>,
  ): Promise<MatchView> {
    return this.matches.moveDraughts(user.id, id, body);
  }

  /** Ayo: lift a pit. */
  @Post(':id/ayo-moves')
  @HttpCode(HttpStatus.OK)
  moveAyo(
    @CurrentUser() user: AuthUser,
    @idParam() id: string,
    @Body(new ZodValidationPipe(ayoMoveSchema)) body: z.output<typeof ayoMoveSchema>,
  ): Promise<MatchView> {
    return this.matches.moveAyo(user.id, id, body);
  }

  /** Ayo: offer to end by agreement, accept, or decline. */
  @Post(':id/ayo-end')
  @HttpCode(HttpStatus.OK)
  endAyo(
    @CurrentUser() user: AuthUser,
    @idParam() id: string,
    @Body(new ZodValidationPipe(ayoEndSchema)) body: z.output<typeof ayoEndSchema>,
  ): Promise<MatchView> {
    return this.matches.endAyo(user.id, id, body);
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
