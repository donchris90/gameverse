import { ludoPayouts, type LudoSeat } from '@gameverse/game-rules';

/** The parts of a match the money needs. A match row from the database fits. */
export interface SettlementMatch {
  id: string;
  gameId: string;
  entryFee: number;
  status: string;
  winnerSeat: number | null;
  state: unknown;
  players: readonly { seat: number; userId: string | null }[];
}

export interface Settlement {
  userId: string;
  amount: number;
  /** POT: a share of the winnings. REFUND: the player's own entry fee coming back. */
  kind: 'POT' | 'REFUND';
}

/** Statuses a match never leaves. Reaching one settles the entry fees, exactly once. */
export const ENDED_STATUSES: ReadonlySet<string> = new Set([
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
  'ABANDONED',
]);

interface LudoSettlementState {
  players: number;
  placings: readonly LudoSeat[] | null;
  removed: readonly LudoSeat[];
}

function ludoState(state: unknown): LudoSettlementState | null {
  if (typeof state !== 'object' || state === null) return null;
  const candidate = state as Partial<LudoSettlementState>;
  if (!Array.isArray(candidate.placings) || !Array.isArray(candidate.removed)) return null;
  if (typeof candidate.players !== 'number') return null;
  return candidate as LudoSettlementState;
}

/**
 * Who is paid what when a match ends. Pure, so the server settles with it and the phone's summary
 * line comes from the same numbers. `pot` defaults to the fees of everyone at the table; the
 * server passes the sum it actually collected.
 *
 * - A finished match pays the winner the whole pot; a Ludo table pays by finishing order
 *   (see `ludoPayouts`: two thirds and one third with four players, nothing to a player who left).
 * - A draw, a cancellation, an expiry or an abandon returns every fee.
 */
export function settlementOf(match: SettlementMatch, pot?: number): Settlement[] {
  if (match.entryFee <= 0 || !ENDED_STATUSES.has(match.status)) return [];
  const humans = match.players.filter(
    (player): player is { seat: number; userId: string } => player.userId !== null,
  );
  const total = pot ?? match.entryFee * humans.length;
  const refunds = (): Settlement[] =>
    humans.map((player) => ({ userId: player.userId, amount: match.entryFee, kind: 'REFUND' }));
  if (match.status !== 'COMPLETED') return refunds();

  if (match.gameId === 'ludo') {
    const ludo = ludoState(match.state);
    if (ludo?.placings) {
      const paid = ludoPayouts(
        total,
        ludo.players as 2 | 3 | 4,
        ludo.placings,
        ludo.removed,
      ).flatMap((share) => {
        const userId = humans.find((player) => player.seat === share.seat)?.userId;
        return userId === undefined ? [] : [{ userId, amount: share.amount, kind: 'POT' as const }];
      });
      // Every coin collected must be paid out; if the shares do not add up, hand the fees back.
      return paid.reduce((sum, share) => sum + share.amount, 0) === total ? paid : refunds();
    }
  }

  if (match.winnerSeat === null) return refunds();
  const winner = humans.find((player) => player.seat === match.winnerSeat);
  return winner === undefined ? refunds() : [{ userId: winner.userId, amount: total, kind: 'POT' }];
}
