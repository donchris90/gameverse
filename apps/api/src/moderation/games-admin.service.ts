import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode, type AdminGameView } from '@gameverse/shared-types';
import type { AuthUser } from '../auth/auth.types.js';
import { AppException } from '../common/app.exception.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { runSerializable } from '../social/serializable.js';
import { recordAudit } from './audit.service.js';

/**
 * Switching games on and off. A game that is off is hidden from players and cannot start new
 * matches or rooms; matches already in progress finish normally. Every change is audited with
 * who made it and why, in the same transaction as the change.
 */
@Injectable()
export class GamesAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<AdminGameView[]> {
    const rows = await this.prisma.game.findMany({ orderBy: { id: 'asc' } });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      minPlayers: row.minPlayers,
      maxPlayers: row.maxPlayers,
    }));
  }

  async setEnabled(
    actor: AuthUser,
    gameId: string,
    enabled: boolean,
    reason: string,
  ): Promise<AdminGameView> {
    return runSerializable(this.prisma, async (tx) => {
      const game = await tx.game.findUnique({ where: { id: gameId } });
      if (!game) {
        throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Game not found');
      }
      if (game.enabled !== enabled) {
        await tx.game.update({ where: { id: gameId }, data: { enabled } });
        await recordAudit(tx, {
          actorId: actor.id,
          action: enabled ? 'GAME_ENABLED' : 'GAME_DISABLED',
          targetType: 'game',
          metadata: { gameId, reason, previouslyEnabled: game.enabled },
        });
      }
      return {
        id: game.id,
        name: game.name,
        enabled,
        minPlayers: game.minPlayers,
        maxPlayers: game.maxPlayers,
      };
    });
  }
}
