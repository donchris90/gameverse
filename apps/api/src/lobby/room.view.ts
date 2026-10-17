import type { RoomView } from '@gameverse/shared-types';
import type { GameRoom } from '../generated/prisma/client.js';

export type PartyLookup = ReadonlyMap<string, { username: string; avatarId: string }>;

function party(lookup: PartyLookup, userId: string) {
  const profile = lookup.get(userId);
  return { userId, username: profile?.username ?? 'Player', avatarId: profile?.avatarId ?? '' };
}

/**
 * `viewerId` decides whether the code is revealed (host only). An OPEN room past its expiry is
 * reported as EXPIRED even before the sweeper has written that down.
 */
export function toRoomView(
  room: GameRoom,
  viewerId: string,
  lookup: PartyLookup,
  now: Date,
): RoomView {
  const expired = room.status === 'OPEN' && room.expiresAt.getTime() <= now.getTime();
  return {
    id: room.id,
    code: room.hostId === viewerId ? room.code : null,
    gameId: room.gameId as RoomView['gameId'],
    status: expired ? 'EXPIRED' : room.status,
    host: party(lookup, room.hostId),
    invited: room.invitedUserId === null ? null : party(lookup, room.invitedUserId),
    expiresAt: room.expiresAt.toISOString(),
    matchId: room.matchId,
    createdAt: room.createdAt.toISOString(),
  };
}
