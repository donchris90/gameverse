import type { Relationship, UserCard } from '@gameverse/shared-types';
import { orderedPair } from './pair.js';
import type { Tx } from './serializable.js';

export async function isBlockedEitherWay(db: Tx, a: string, b: string): Promise<boolean> {
  const count = await db.blockedUser.count({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
  });
  return count > 0;
}

export async function areFriends(db: Tx, a: string, b: string): Promise<boolean> {
  const { low, high } = orderedPair(a, b);
  return (await db.friendship.count({ where: { userLowId: low, userHighId: high } })) > 0;
}

/** Relationship of `me` to each of `otherIds`, using two queries regardless of how many ids. */
export async function relationshipsFor(
  db: Tx,
  me: string,
  otherIds: readonly string[],
): Promise<Map<string, Relationship>> {
  const result = new Map<string, Relationship>(otherIds.map((id) => [id, 'NONE']));
  if (otherIds.length === 0) return result;

  const friendships = await db.friendship.findMany({
    where: {
      OR: [
        { userLowId: me, userHighId: { in: [...otherIds] } },
        { userHighId: me, userLowId: { in: [...otherIds] } },
      ],
    },
    select: { userLowId: true, userHighId: true },
  });
  for (const f of friendships)
    result.set(f.userLowId === me ? f.userHighId : f.userLowId, 'FRIEND');

  const requests = await db.friendRequest.findMany({
    where: {
      status: 'PENDING',
      OR: [
        { senderId: me, receiverId: { in: [...otherIds] } },
        { receiverId: me, senderId: { in: [...otherIds] } },
      ],
    },
    select: { senderId: true, receiverId: true },
  });
  for (const r of requests) {
    if (r.senderId === me) result.set(r.receiverId, 'REQUEST_SENT');
    else result.set(r.senderId, 'REQUEST_RECEIVED');
  }
  return result;
}

export function toCard(
  profile: { userId: string; username: string; avatarId: string },
  relationship: Relationship,
): UserCard {
  return {
    userId: profile.userId,
    username: profile.username,
    avatarId: profile.avatarId,
    relationship,
  };
}
