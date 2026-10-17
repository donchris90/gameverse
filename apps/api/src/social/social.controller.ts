import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  type FriendRequestResult,
  type FriendRequestView,
  type Page,
  type UserCard,
  type UserProfileView,
  friendRequestDirectionSchema,
  pageQuerySchema,
  searchUsersQuerySchema,
  targetUserSchema,
  userIdSchema,
} from '@gameverse/shared-types';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { BlocksService } from './blocks.service.js';
import { FriendsService } from './friends.service.js';

type Target = z.output<typeof targetUserSchema>;
type PageQuery = z.output<typeof pageQuerySchema>;
type Direction = z.output<typeof friendRequestDirectionSchema>;
type Search = z.output<typeof searchUsersQuerySchema>;

const uuidParam = (name: string) => Param(name, new ZodValidationPipe(userIdSchema));

@Controller()
@UseGuards(JwtAuthGuard)
export class SocialController {
  constructor(
    private readonly friends: FriendsService,
    private readonly blocks: BlocksService,
  ) {}

  @Get('users/search')
  search(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(searchUsersQuerySchema)) query: Search,
  ): Promise<UserCard[]> {
    return this.friends.search(user.id, query.q);
  }

  @Get('users/:userId/profile')
  viewProfile(
    @CurrentUser() user: AuthUser,
    @uuidParam('userId') userId: string,
  ): Promise<UserProfileView> {
    return this.friends.viewProfile(user.id, userId);
  }

  @Get('friends')
  listFriends(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery,
  ): Promise<Page<UserCard>> {
    return this.friends.listFriends(user.id, query.limit, query.cursor);
  }

  @Delete('friends/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeFriend(@CurrentUser() user: AuthUser, @uuidParam('userId') userId: string): Promise<void> {
    return this.friends.removeFriend(user.id, userId);
  }

  @Post('friends/requests')
  @HttpCode(HttpStatus.OK)
  sendRequest(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(targetUserSchema)) body: Target,
  ): Promise<FriendRequestResult> {
    return this.friends.sendRequest(user.id, body.userId);
  }

  @Get('friends/requests')
  listRequests(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(friendRequestDirectionSchema)) direction: Direction,
    @Query(new ZodValidationPipe(pageQuerySchema)) page: PageQuery,
  ): Promise<Page<FriendRequestView>> {
    return this.friends.listRequests(user.id, direction.direction, page.limit, page.cursor);
  }

  @Post('friends/requests/:requestId/accept')
  @HttpCode(HttpStatus.NO_CONTENT)
  accept(@CurrentUser() user: AuthUser, @uuidParam('requestId') requestId: string): Promise<void> {
    return this.friends.acceptRequest(user.id, requestId);
  }

  @Post('friends/requests/:requestId/reject')
  @HttpCode(HttpStatus.NO_CONTENT)
  reject(@CurrentUser() user: AuthUser, @uuidParam('requestId') requestId: string): Promise<void> {
    return this.friends.rejectRequest(user.id, requestId);
  }

  @Delete('friends/requests/:requestId')
  @HttpCode(HttpStatus.NO_CONTENT)
  cancel(@CurrentUser() user: AuthUser, @uuidParam('requestId') requestId: string): Promise<void> {
    return this.friends.cancelRequest(user.id, requestId);
  }

  @Get('blocks')
  listBlocks(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery,
  ): Promise<Page<UserCard>> {
    return this.blocks.list(user.id, query.limit, query.cursor);
  }

  @Post('blocks')
  @HttpCode(HttpStatus.NO_CONTENT)
  block(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(targetUserSchema)) body: Target,
  ): Promise<void> {
    return this.blocks.block(user.id, body.userId);
  }

  @Delete('blocks/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  unblock(@CurrentUser() user: AuthUser, @uuidParam('userId') userId: string): Promise<void> {
    return this.blocks.unblock(user.id, userId);
  }
}
