import type {
  AccountView,
  ConversationPage,
  ConversationView,
  FriendRequestResult,
  FriendRequestView,
  GameId,
  BotLevelName,
  LeaderboardView,
  LobbyOverview,
  MatchView,
  MatchmakingStatus,
  MyProgress,
  RoomJoinResult,
  RoomView,
  VoiceSessionView,
  VoiceTokenView,
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

export const accountApi = {
  verifyEmail: (token: string) =>
    request<{ message: string }>('POST', '/v1/auth/verify-email', { body: { token }, auth: false }),
  resendVerification: () => request<{ message: string }>('POST', '/v1/auth/resend-verification'),
  forgotPassword: (email: string) =>
    request<{ message: string }>('POST', '/v1/auth/forgot-password', {
      body: { email },
      auth: false,
    }),
  resetPassword: (token: string, newPassword: string) =>
    request<{ message: string }>('POST', '/v1/auth/reset-password', {
      body: { token, newPassword },
      auth: false,
    }),
  account: () => request<AccountView>('GET', '/v1/me'),
};

const matchPath = (id: string, action: string) => `/v1/matches/${id}/${action}`;

export const games = {
  currentMatch: () => request<{ match: MatchView | null }>('GET', '/v1/matches/current'),
  match: (id: string) => request<MatchView>('GET', `/v1/matches/${id}`),
  ready: (id: string) => request<MatchView>('POST', matchPath(id, 'ready'), { body: {} }),
  move: (id: string, cell: number, clientActionId: string, expectedVersion: number) =>
    request<MatchView>('POST', matchPath(id, 'moves'), {
      body: { cell, clientActionId, expectedVersion },
    }),
  /** Ludo: the server rolls the die. There is no value to send. */
  roll: (id: string, clientActionId: string, expectedVersion: number) =>
    request<MatchView>('POST', matchPath(id, 'roll'), {
      body: { clientActionId, expectedVersion },
    }),
  /** Ludo: move one of my tokens by the die I rolled. */
  moveToken: (id: string, token: number, clientActionId: string, expectedVersion: number) =>
    request<MatchView>('POST', matchPath(id, 'token-moves'), {
      body: { token, clientActionId, expectedVersion },
    }),
  /** Draughts: move a piece by squares (a capture lists each landing square). The server works out the rest. */
  moveDraughts: (
    id: string,
    from: number,
    path: number[],
    clientActionId: string,
    expectedVersion: number,
  ) =>
    request<MatchView>('POST', matchPath(id, 'draughts-moves'), {
      body: { from, path, clientActionId, expectedVersion },
    }),
  leave: (id: string) => request<MatchView>('POST', matchPath(id, 'leave'), { body: {} }),
  rematch: (id: string) => request<MatchView>('POST', matchPath(id, 'rematch'), { body: {} }),
  startBot: (gameId: GameId, level: BotLevelName, players?: number) =>
    request<MatchView>('POST', '/v1/matches/bot', { body: { gameId, level, players } }),

  queue: () => request<MatchmakingStatus>('GET', '/v1/matchmaking'),
  joinQueue: (gameId: GameId, players?: number) =>
    request<MatchmakingStatus>('POST', '/v1/matchmaking/join', { body: { gameId, players } }),
  cancelQueue: () => request<MatchmakingStatus>('POST', '/v1/matchmaking/cancel', { body: {} }),

  lobby: () => request<LobbyOverview>('GET', '/v1/rooms'),
  createRoom: (gameId: GameId, players?: number) =>
    request<RoomView>('POST', '/v1/rooms', { body: { gameId, players } }),
  /** Joins with a code. `match` is null while the room is still waiting for more players. */
  joinRoomResult: (code: string) =>
    request<RoomJoinResult>('POST', '/v1/rooms/join', { body: { code } }),
  /** Two-player games always start on join; used by the tic-tac-toe screens. */
  joinRoom: async (code: string): Promise<MatchView> => {
    const result = await request<RoomJoinResult>('POST', '/v1/rooms/join', { body: { code } });
    if (result.match === null) throw new Error('The room is waiting for more players');
    return result.match;
  },
  startRoom: (roomId: string, bots: BotLevelName | null = null) =>
    request<MatchView>('POST', `/v1/rooms/${roomId}/start`, { body: { bots } }),
  leaveRoom: (roomId: string) =>
    request<RoomView>('POST', `/v1/rooms/${roomId}/leave`, { body: {} }),
  invite: (friendUserId: string, gameId: GameId) =>
    request<RoomView>('POST', '/v1/rooms/invite', { body: { gameId, friendUserId } }),
  acceptInvite: (roomId: string) =>
    request<MatchView>('POST', `/v1/rooms/${roomId}/accept`, { body: {} }),
  declineInvite: (roomId: string) =>
    request<RoomView>('POST', `/v1/rooms/${roomId}/decline`, { body: {} }),
  closeRoom: (roomId: string) => request<RoomView>('DELETE', `/v1/rooms/${roomId}`),

  progress: () => request<MyProgress>('GET', '/v1/me/progress'),
  leaderboard: (gameId: GameId, offset = 0) =>
    request<LeaderboardView>('GET', `/v1/leaderboards/${gameId}${qs({ limit: 20, offset })}`),
};

export const voiceApi = (matchId: string) => ({
  token: () => request<VoiceTokenView>('POST', `/v1/matches/${matchId}/voice/token`, { body: {} }),
  joined: () =>
    request<VoiceSessionView>('POST', `/v1/matches/${matchId}/voice/joined`, { body: {} }),
  left: () =>
    request<{ closed: number }>('POST', `/v1/matches/${matchId}/voice/left`, { body: {} }),
});
