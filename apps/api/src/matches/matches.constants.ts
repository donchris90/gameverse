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
