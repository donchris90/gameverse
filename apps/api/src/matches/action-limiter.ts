/**
 * Sliding-window limiter keyed by user id, for match actions. The global throttler is per IP; a
 * game needs a per-account limit too (many players share one mobile-carrier IP). In memory, like
 * presence: fine for the single-instance launch architecture.
 */
export class ActionLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records an action; returns false when the user is over the limit (the action is not recorded). */
  tryConsume(userId: string, now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(userId) ?? []).filter((at) => at > cutoff);
    if (recent.length >= this.limit) {
      this.hits.set(userId, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(userId, recent);
    return true;
  }

  /** Drops users with no recent actions so the map cannot grow without bound. */
  prune(now: number = Date.now()): void {
    const cutoff = now - this.windowMs;
    for (const [userId, times] of this.hits) {
      if (!times.some((at) => at > cutoff)) this.hits.delete(userId);
    }
  }

  get size(): number {
    return this.hits.size;
  }
}
