import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  VOICE_MAX_SESSION_SECONDS,
  VOICE_RENEW_BEFORE_EXPIRY_SECONDS,
  VOICE_TOKEN_LIMIT_PER_MINUTE,
  voiceChannelForMatch,
  voiceUidForSeat,
  type VoiceEndReason,
  type VoiceParticipantView,
  type VoiceSessionView,
  type VoiceTokenView,
} from '@gameverse/shared-types';
import { AppException } from '../common/app.exception.js';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { ActionLimiter } from '../matches/action-limiter.js';
import { OPEN_STATUSES } from '../matches/matches.constants.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { runSerializable, type Tx } from '../social/serializable.js';
import { VoiceNotConfiguredError, VoiceProvider } from './voice.provider.js';

const TOKEN_WINDOW_MS = 60_000;

function notFound(): AppException {
  // One answer for "no such match" and "not your match".
  return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Match not found');
}

function unavailable(message: string): AppException {
  return new AppException(HttpStatus.CONFLICT, ErrorCode.VOICE_UNAVAILABLE, message);
}

interface Eligible {
  matchId: string;
  mySeat: number;
  humans: { seat: number; userId: string }[];
}

@Injectable()
export class VoiceService {
  private readonly limiter = new ActionLimiter(VOICE_TOKEN_LIMIT_PER_MINUTE, TOKEN_WINDOW_MS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: VoiceProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Who may use voice in this match right now. Anyone who is not a seated human gets the same 404
   * as a missing match. Voice needs an open match, a second human, and no block between them.
   */
  private async authorize(db: Tx, userId: string, matchId: string): Promise<Eligible> {
    const match = await db.gameMatch.findUnique({
      where: { id: matchId },
      select: { id: true, status: true, players: { select: { seat: true, userId: true } } },
    });
    const me = match?.players.find((player) => player.userId === userId);
    if (!match || !me) throw notFound();
    if (!(OPEN_STATUSES as readonly string[]).includes(match.status)) {
      throw unavailable('Voice is only available while the match is open');
    }
    const humans = match.players.flatMap((player) =>
      player.userId === null ? [] : [{ seat: player.seat, userId: player.userId }],
    );
    const others = humans.filter((human) => human.userId !== userId);
    if (others.length === 0) throw unavailable('Voice needs another player. Bots have no voice.');
    const blocked = await db.blockedUser.count({
      where: {
        OR: others.flatMap((other) => [
          { blockerId: userId, blockedId: other.userId },
          { blockerId: other.userId, blockedId: userId },
        ]),
      },
    });
    if (blocked > 0) throw unavailable('Voice is not available in this match');
    return { matchId: match.id, mySeat: me.seat, humans };
  }

  async token(userId: string, matchId: string, now: Date = new Date()): Promise<VoiceTokenView> {
    if (!this.limiter.tryConsume(userId, now.getTime())) {
      throw new AppException(
        HttpStatus.TOO_MANY_REQUESTS,
        ErrorCode.RATE_LIMITED,
        'Too many voice requests. Try again in a moment.',
      );
    }
    const eligible = await this.authorize(this.prisma, userId, matchId);
    const profiles = await this.prisma.userProfile.findMany({
      where: { userId: { in: eligible.humans.map((human) => human.userId) } },
      select: { userId: true, username: true, avatarId: true },
    });
    const byUser = new Map(profiles.map((profile) => [profile.userId, profile]));
    const participants: VoiceParticipantView[] = eligible.humans.flatMap((human) => {
      const profile = byUser.get(human.userId);
      return profile
        ? [
            {
              uid: voiceUidForSeat(human.seat),
              userId: human.userId,
              username: profile.username,
              avatarId: profile.avatarId,
            },
          ]
        : [];
    });

    const ttlSeconds = this.config.VOICE_MATCH_TOKEN_TTL_SECONDS;
    try {
      const grant = this.provider.issueToken(
        {
          channel: voiceChannelForMatch(matchId),
          uid: voiceUidForSeat(eligible.mySeat),
          ttlSeconds,
        },
        now,
      );
      return {
        appId: grant.appId,
        channel: grant.channel,
        uid: grant.uid,
        token: grant.token,
        expiresAt: grant.expiresAt.toISOString(),
        serverTime: now.toISOString(),
        renewInSeconds: Math.max(30, ttlSeconds - VOICE_RENEW_BEFORE_EXPIRY_SECONDS),
        participants,
      };
    } catch (error) {
      if (error instanceof VoiceNotConfiguredError) {
        throw new AppException(
          HttpStatus.SERVICE_UNAVAILABLE,
          ErrorCode.SERVICE_UNAVAILABLE,
          'Voice is not available',
        );
      }
      throw error;
    }
  }

  private view(row: {
    id: string;
    matchId: string;
    channel: string;
    joinedAt: Date;
    leftAt: Date | null;
    seconds: number | null;
  }): VoiceSessionView {
    return {
      id: row.id,
      matchId: row.matchId,
      channel: row.channel,
      joinedAt: row.joinedAt.toISOString(),
      leftAt: row.leftAt?.toISOString() ?? null,
      seconds: row.seconds,
    };
  }

  /** The app says it is now in the channel. Repeating the call returns the same open session. */
  async joined(userId: string, matchId: string, now: Date = new Date()): Promise<VoiceSessionView> {
    const row = await runSerializable(this.prisma, async (tx) => {
      const eligible = await this.authorize(tx, userId, matchId);
      const open = await tx.voiceSession.findFirst({
        where: { matchId, userId, leftAt: null },
        orderBy: { joinedAt: 'desc' },
      });
      if (open) return open;
      return tx.voiceSession.create({
        data: {
          matchId,
          userId,
          agoraUid: voiceUidForSeat(eligible.mySeat),
          channel: voiceChannelForMatch(matchId),
          joinedAt: now,
        },
      });
    });
    return this.view(row);
  }

  /** The app says it left. Idempotent, and allowed after the match ended (membership only). */
  async left(
    userId: string,
    matchId: string,
    now: Date = new Date(),
    reason: VoiceEndReason = 'left',
  ): Promise<{ closed: number }> {
    const member = await this.prisma.gameMatchPlayer.count({ where: { matchId, userId } });
    if (member === 0) throw notFound();
    const closed = await runSerializable(this.prisma, async (tx) => {
      const open = await tx.voiceSession.findMany({ where: { matchId, userId, leftAt: null } });
      for (const session of open) await this.close(tx, session, now, reason);
      return open.length;
    });
    return { closed };
  }

  private async close(
    tx: Tx,
    session: { id: string; joinedAt: Date },
    leftAt: Date,
    reason: VoiceEndReason,
  ): Promise<void> {
    const end = leftAt.getTime() < session.joinedAt.getTime() ? session.joinedAt : leftAt;
    await tx.voiceSession.update({
      where: { id: session.id },
      data: {
        leftAt: end,
        endReason: reason,
        seconds: Math.round((end.getTime() - session.joinedAt.getTime()) / 1000),
      },
    });
  }

  /**
   * Sweeper: closes sessions whose match is no longer open (counted until the match ended) and
   * sessions nobody closed within the maximum length. Returns how many were closed.
   */
  async closeStale(now: Date = new Date()): Promise<number> {
    return runSerializable(this.prisma, async (tx) => {
      const cutoff = new Date(now.getTime() - VOICE_MAX_SESSION_SECONDS * 1000);
      const open = await tx.voiceSession.findMany({
        where: { leftAt: null },
        include: { match: { select: { status: true, endedAt: true } } },
      });
      let closed = 0;
      for (const session of open) {
        const matchOpen = (OPEN_STATUSES as readonly string[]).includes(session.match.status);
        if (!matchOpen) {
          await this.close(tx, session, session.match.endedAt ?? now, 'match_ended');
          closed += 1;
        } else if (session.joinedAt < cutoff) {
          await this.close(tx, session, now, 'timeout');
          closed += 1;
        }
      }
      return closed;
    });
  }
}
