interface AttemptState {
  count: number;
  resetAt: number;
}

const attempts = new Map<string, AttemptState>();
const WINDOW_MS = 15 * 60 * 1000;
const LIMIT = 5;

export function rateLimitKey(ip: string, invite: string): string {
  return `${ip}:${invite.slice(0, 12)}`;
}

export function canAttempt(key: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const state = attempts.get(key);
  if (!state || state.resetAt <= now) {
    attempts.set(key, { count: 0, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfter: 0 };
  }
  if (state.count >= LIMIT) {
    return { allowed: false, retryAfter: Math.ceil((state.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

export function recordFailure(key: string): void {
  const now = Date.now();
  const state = attempts.get(key);
  if (!state || state.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    state.count += 1;
  }
}

export function clearFailures(key: string): void {
  attempts.delete(key);
}
