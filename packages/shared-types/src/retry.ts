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
