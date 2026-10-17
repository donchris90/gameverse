import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  type ConversationPage,
  type ConversationView,
  type MessageView,
  type Page,
  conversationsQuerySchema,
  markReadSchema,
  messagesQuerySchema,
  muteConversationSchema,
  openConversationSchema,
  sendMessageSchema,
  userIdSchema,
} from '@gameverse/shared-types';
import type { Response } from 'express';
import type { z } from 'zod';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ChatService } from './chat.service.js';

const idParam = (name: string) => Param(name, new ZodValidationPipe(userIdSchema));

@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  open(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(openConversationSchema))
    body: z.output<typeof openConversationSchema>,
  ): Promise<ConversationView> {
    return this.chat.openConversation(user.id, body.userId);
  }

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(conversationsQuerySchema))
    query: z.output<typeof conversationsQuerySchema>,
  ): Promise<ConversationPage> {
    return this.chat.listConversations(user.id, query.limit, query.cursor);
  }

  @Get(':conversationId/messages')
  messages(
    @CurrentUser() user: AuthUser,
    @idParam('conversationId') conversationId: string,
    @Query(new ZodValidationPipe(messagesQuerySchema)) query: z.output<typeof messagesQuerySchema>,
  ): Promise<Page<MessageView>> {
    return this.chat.getMessages(user.id, conversationId, query.limit, query.before);
  }

  /** 201 for a new message, 200 when the same clientMessageId was already accepted. */
  @Post(':conversationId/messages')
  async send(
    @CurrentUser() user: AuthUser,
    @idParam('conversationId') conversationId: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) body: z.output<typeof sendMessageSchema>,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MessageView> {
    const result = await this.chat.sendMessage(user.id, conversationId, body);
    response.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result.message;
  }

  @Post(':conversationId/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  read(
    @CurrentUser() user: AuthUser,
    @idParam('conversationId') conversationId: string,
    @Body(new ZodValidationPipe(markReadSchema)) body: z.output<typeof markReadSchema>,
  ): Promise<void> {
    return this.chat.markRead(user.id, conversationId, body.messageId);
  }

  @Patch(':conversationId/mute')
  mute(
    @CurrentUser() user: AuthUser,
    @idParam('conversationId') conversationId: string,
    @Body(new ZodValidationPipe(muteConversationSchema))
    body: z.output<typeof muteConversationSchema>,
  ): Promise<{ muted: boolean }> {
    return this.chat.setMuted(user.id, conversationId, body.muted);
  }
}
