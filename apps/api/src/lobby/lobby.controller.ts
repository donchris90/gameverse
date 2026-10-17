import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  type MatchView,
  type MatchmakingStatus,
  type RoomView,
  createRoomSchema,
  inviteFriendSchema,
  joinQueueSchema,
  joinRoomSchema,
  roomIdSchema,
  emptyActionSchema,
} from '@gameverse/shared-types';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MatchmakingService } from './matchmaking.service.js';
import { RoomsService, type LobbyOverview } from './rooms.service.js';

const roomId = () => Param('id', new ZodValidationPipe(roomIdSchema));

@Controller()
@UseGuards(JwtAuthGuard)
export class LobbyController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly matchmaking: MatchmakingService,
  ) {}

  // -------------------------------------------------------------- matchmaking

  @Get('matchmaking')
  status(@CurrentUser() user: AuthUser): Promise<MatchmakingStatus> {
    return this.matchmaking.status(user.id);
  }

  @Post('matchmaking/join')
  @HttpCode(HttpStatus.OK)
  join(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(joinQueueSchema)) body: z.output<typeof joinQueueSchema>,
  ): Promise<MatchmakingStatus> {
    return this.matchmaking.join(user.id, body.gameId);
  }

  @Post('matchmaking/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(emptyActionSchema)) _body: unknown,
  ): Promise<MatchmakingStatus> {
    return this.matchmaking.cancel(user.id);
  }

  // -------------------------------------------------------------------- rooms

  @Get('rooms')
  overview(@CurrentUser() user: AuthUser): Promise<LobbyOverview> {
    return this.rooms.overview(user.id);
  }

  @Post('rooms')
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createRoomSchema)) body: z.output<typeof createRoomSchema>,
  ): Promise<RoomView> {
    return this.rooms.create(user.id, body.gameId);
  }

  @Post('rooms/join')
  @HttpCode(HttpStatus.OK)
  joinByCode(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(joinRoomSchema)) body: z.output<typeof joinRoomSchema>,
  ): Promise<MatchView> {
    return this.rooms.joinByCode(user.id, body.code);
  }

  @Post('rooms/invite')
  invite(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(inviteFriendSchema)) body: z.output<typeof inviteFriendSchema>,
  ): Promise<RoomView> {
    return this.rooms.invite(user.id, body.friendUserId, body.gameId);
  }

  @Post('rooms/:id/accept')
  @HttpCode(HttpStatus.OK)
  accept(@CurrentUser() user: AuthUser, @roomId() id: string): Promise<MatchView> {
    return this.rooms.accept(user.id, id);
  }

  @Post('rooms/:id/decline')
  @HttpCode(HttpStatus.OK)
  decline(@CurrentUser() user: AuthUser, @roomId() id: string): Promise<RoomView> {
    return this.rooms.decline(user.id, id);
  }

  @Delete('rooms/:id')
  close(@CurrentUser() user: AuthUser, @roomId() id: string): Promise<RoomView> {
    return this.rooms.close(user.id, id);
  }
}
