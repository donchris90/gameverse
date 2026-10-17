import type {
  ConversationPage,
  ConversationView,
  FriendRequestResult,
  FriendRequestView,
  MessageView,
  Page,
  PresenceEntry,
  ProfileView,
  ReportReason,
  SettingsView,
  UserCard,
  UserProfileView,
  UsernameCheckResult,
} from '@gameverse/shared-types';
import { qs, request } from './http';

export const social = {
  search: (q: string) => request<UserCard[]>('GET', `/v1/users/search${qs({ q })}`),
  profile: (id: string) => request<UserProfileView>('GET', `/v1/users/${id}/profile`),
  friends: () => request<Page<UserCard>>('GET', '/v1/friends'),
  removeFriend: (id: string) => request<void>('DELETE', `/v1/friends/${id}`),
  requests: (direction: 'incoming' | 'outgoing') =>
    request<Page<FriendRequestView>>('GET', `/v1/friends/requests${qs({ direction })}`),
  sendRequest: (userId: string) =>
    request<FriendRequestResult>('POST', '/v1/friends/requests', { body: { userId } }),
  accept: (id: string) => request<void>('POST', `/v1/friends/requests/${id}/accept`),
  reject: (id: string) => request<void>('POST', `/v1/friends/requests/${id}/reject`),
  cancel: (id: string) => request<void>('DELETE', `/v1/friends/requests/${id}`),
  blocks: () => request<Page<UserCard>>('GET', '/v1/blocks'),
  block: (userId: string) => request<void>('POST', '/v1/blocks', { body: { userId } }),
  unblock: (userId: string) => request<void>('DELETE', `/v1/blocks/${userId}`),
  report: (userId: string, reason: ReportReason, details: string | null, messageId?: string) =>
    request<unknown>('POST', '/v1/reports', {
      body: { userId, reason, details, ...(messageId ? { messageId } : {}) },
    }),
};

export const chat = {
  open: (userId: string) =>
    request<ConversationView>('POST', '/v1/conversations', { body: { userId } }),
  list: () => request<ConversationPage>('GET', '/v1/conversations'),
  messages: (conversationId: string, before?: string) =>
    request<Page<MessageView>>(
      'GET',
      `/v1/conversations/${conversationId}/messages${qs({ before })}`,
    ),
  send: (conversationId: string, body: string, clientMessageId: string) =>
    request<MessageView>('POST', `/v1/conversations/${conversationId}/messages`, {
      body: { body, clientMessageId },
    }),
  markRead: (conversationId: string, messageId?: string) =>
    request<void>('POST', `/v1/conversations/${conversationId}/read`, {
      body: messageId ? { messageId } : {},
    }),
  mute: (conversationId: string, muted: boolean) =>
    request<{ muted: boolean }>('PATCH', `/v1/conversations/${conversationId}/mute`, {
      body: { muted },
    }),
};

export const me = {
  profile: () => request<ProfileView>('GET', '/v1/me/profile'),
  saveProfile: (username: string, avatarId: string, bio: string | null) =>
    request<ProfileView>('PUT', '/v1/me/profile', { body: { username, avatarId, bio } }),
  checkUsername: (username: string) =>
    request<UsernameCheckResult>('GET', `/v1/usernames/check${qs({ username })}`),
  settings: () => request<SettingsView>('GET', '/v1/me/settings'),
  updateSettings: (patch: Partial<SettingsView>) =>
    request<SettingsView>('PATCH', '/v1/me/settings', { body: patch }),
  presence: (userIds: string[]) =>
    request<PresenceEntry[]>('POST', '/v1/presence/query', { body: { userIds } }),
  requestDeletion: () => request<{ message: string }>('POST', '/v1/me/deletion/request'),
  confirmDeletion: (token: string) =>
    request<void>('POST', '/v1/me/deletion/confirm', { body: { token } }),
  registerDevice: (token: string, platform: 'IOS' | 'ANDROID') =>
    request<void>('PUT', '/v1/me/devices', { body: { token, platform } }),
  unregisterDevice: (token: string) => request<void>('DELETE', `/v1/me/devices${qs({ token })}`),
};
