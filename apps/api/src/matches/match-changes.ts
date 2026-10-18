import type { Prisma } from '../generated/prisma/client.js';

/** A seat in any game: tic-tac-toe uses 0-1, Ludo 0-3. */
export type AnySeat = 0 | 1 | 2 | 3;

/** One entry for the append-only event log. */
export interface EventDraft {
  type: string;
  seat?: AnySeat;
  clientActionId?: string;
  data?: Prisma.InputJsonValue;
}

/** A change to apply to a match row, plus the events that explain it. */
export interface Change {
  /** Plain column changes only (scalars and enums); relations are handled explicitly. */
  patch: Prisma.GameMatchUncheckedUpdateManyInput;
  /** A seat that has just pressed ready. */
  readySeat?: AnySeat;
  /** Seats that have just left or been removed from a game that goes on without them. */
  outSeats?: AnySeat[];
  events: EventDraft[];
}

export type Outcome = { changed: false } | { changed: true; change: Change };
