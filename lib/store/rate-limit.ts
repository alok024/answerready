// lib/store/rate-limit.ts - per-key sliding-window limiter behind a swappable store (Node built-ins only).
// Guards the generator route from abuse; the in-memory store below is the default and can be
// swapped for a shared backend later (see getRateLimitStore) without changing any caller.

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

export interface RateLimitStore {
  hit(key: string, now?: number): RateLimitResult;
}

export const WINDOW_MS: number = 60_000; // sliding window length in ms
export const MAX_HITS: number = 20; // max requests per key per window

// In-memory sliding-window store (default). Prunes timestamps older than the window on each hit,
// then records the new hit and reports whether the key is still under the limit.
export function createMemoryRateLimitStore(opts?: { windowMs?: number; maxHits?: number }): RateLimitStore {
  const windowMs = opts?.windowMs ?? WINDOW_MS;
  const maxHits = opts?.maxHits ?? MAX_HITS;
  const hits = new Map<string, number[]>();

  return {
    hit(key: string, now: number = Date.now()): RateLimitResult {
      const cutoff = now - windowMs;
      const kept = (hits.get(key) ?? []).filter((t) => t > cutoff);
      if (kept.length === 0) hits.delete(key); // drop empty keys so idle callers don't leak memory
      kept.push(now);
      hits.set(key, kept);

      const allowed = kept.length <= maxHits;
      const remaining = Math.max(0, maxHits - kept.length);
      const resetMs = kept[0] + windowMs - now; // ms until the oldest hit ages out of the window

      return { allowed, remaining, resetMs };
    },
  };
}

let processStore: RateLimitStore | undefined;

// Process-singleton store (default = memory). To move to a shared backend later, swap the body
// for e.g. `processStore ??= createUpstashRateLimitStore(...)` - callers only depend on the
// RateLimitStore.hit() interface above, so no call site needs to change.
export function getRateLimitStore(): RateLimitStore {
  if (!processStore) processStore = createMemoryRateLimitStore();
  return processStore;
}

// Best-effort client IP from x-forwarded-for (first hop) / x-real-ip; fixed fallback key when absent.
export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  if (first) return first;

  const real = req.headers.get('x-real-ip')?.trim();
  if (real) return real;

  return 'unknown';
}
