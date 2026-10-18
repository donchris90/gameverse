/** The API answers 503 when a serializable transaction lost every retry; nothing was committed. */
export const RETRY_MAX_ATTEMPTS = 3;
const BASE_MS = 150;
const CAP_MS = 1200;

/** Whether a failed response may be sent again. 503 means the server rolled the request back. */
export function shouldRetry(status: number, attempt: number): boolean {
  return status === 503 && attempt < RETRY_MAX_ATTEMPTS;
}

/** Full-jitter exponential backoff. `attempt` is the number of tries already made (1-based). */
export function retryDelayMs(attempt: number, random: () => number): number {
  const ceiling = Math.min(CAP_MS, BASE_MS * 2 ** (attempt - 1));
  return Math.floor(random() * ceiling);
}

/**
 * Delay before reconnecting a dropped socket: exponential from 1 s (cap `maxMs`) with 50 % jitter,
 * so thousands of phones dropped by one API restart do not all come back in the same second.
 * `attempt` is 1 for the first retry.
 */
export function reconnectDelayMs(attempt: number, random: () => number, maxMs = 30_000): number {
  const ceiling = Math.min(maxMs, 1000 * 2 ** Math.min(attempt, 5));
  return Math.floor(ceiling * (0.5 + random() * 0.5));
}
