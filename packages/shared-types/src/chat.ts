import { z } from 'zod';
import { MESSAGE_MAX_LENGTH, PAGE_SIZE_MAX } from './constants.js';
import type { Page, UserCard } from './social.js';

export const openConversationSchema = z.object({ userId: z.uuid() });

export const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(MESSAGE_MAX_LENGTH),
  /** Client-generated idempotency key; retrying a send with the same key never duplicates it. */
  clientMessageId: z.uuid(),
});

export const messagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(30),
  /** Return messages older than this message id. */
  before: z.uuid().optional(),
});

export const conversationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(30),
  cursor: z.string().min(1).max(200).optional(),
});

export const markReadSchema = z.object({ messageId: z.uuid().optional() });
export const muteConversationSchema = z.object({ muted: z.boolean() });

export interface MessageView {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  clientMessageId: string;
  createdAt: string;
}

export interface ConversationView {
  id: string;
  /** The other participant. */
  user: UserCard;
  lastMessage: MessageView | null;
  unreadCount: number;
  muted: boolean;
}

export type ConversationPage = Page<ConversationView>;

/** Events pushed over the WebSocket. Delivery only: sending happens over REST. */
export type RealtimeEvent =
  | { type: 'ready'; userId: string }
  | { type: 'pong' }
  | { type: 'message.new'; conversationId: string; message: MessageView }
  | { type: 'message.read'; conversationId: string; userId: string; lastReadMessageId: string }
  | { type: 'error'; code: string };
