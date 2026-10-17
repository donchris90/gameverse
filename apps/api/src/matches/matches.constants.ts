/** How long both players have to press "ready" after a match is created. */
export const READY_TIMEOUT_MS = 30_000;
/** Pause between the end of one game and the start of the next, so players can see the result. */
export const NEXT_GAME_DELAY_MS = 3_000;
/** How often overdue deadlines are looked for. */
export const SWEEP_INTERVAL_MS = 1_000;
/** Open matches a single sweep will handle; the rest wait for the next sweep. */
export const SWEEP_BATCH = 50;

export const OPEN_STATUSES = ['WAITING', 'READY', 'ACTIVE'] as const;

export const BOT_NAME = 'Bot';
export const BOT_AVATAR_ID = 'bot';

/** Match actions (ready, move, leave, rematch) a single player may send in one window. */
export const ACTION_LIMIT = 30;
export const ACTION_WINDOW_MS = 10_000;

/** A bot waits this long before answering, so the move does not appear instantly like a script. */
export const BOT_THINK_MS = 800;
/** How often bots are given the chance to move. */
export const BOT_SWEEP_INTERVAL_MS = 250;
