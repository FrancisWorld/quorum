export interface BucketConfig {
  capacity: number;
  refillPerSecond: number;
}

export interface BucketState {
  tokens: number;
  updatedAt: number;
}

export interface ConsumeResult {
  allowed: boolean;
  state: BucketState;
  retryAfterMs: number;
}

/** Token bucket. Pure: the caller persists `state` and supplies `now`. */
export function consumeToken(previous: BucketState | null, now: number, config: BucketConfig): ConsumeResult {
  const elapsedSeconds = previous ? Math.max(0, now - previous.updatedAt) / 1000 : 0;
  const available = previous
    ? Math.min(config.capacity, previous.tokens + elapsedSeconds * config.refillPerSecond)
    : config.capacity;

  if (available >= 1) {
    return { allowed: true, state: { tokens: available - 1, updatedAt: now }, retryAfterMs: 0 };
  }
  return {
    allowed: false,
    state: { tokens: available, updatedAt: now },
    retryAfterMs: Math.ceil(((1 - available) / config.refillPerSecond) * 1000),
  };
}

/** Anti-spam budgets. Questions are the scarce resource, votes are cheap. */
export const RATE_LIMITS = {
  question: { capacity: 3, refillPerSecond: 1 / 15 },
  vote: { capacity: 20, refillPerSecond: 2 },
  pollVote: { capacity: 10, refillPerSecond: 1 },
  join: { capacity: 5, refillPerSecond: 1 / 12 },
  createRoom: { capacity: 3, refillPerSecond: 1 / 60 },
  heartbeat: { capacity: 6, refillPerSecond: 1 / 5 },
} as const satisfies Record<string, BucketConfig>;

export type RateLimitKind = keyof typeof RATE_LIMITS;
