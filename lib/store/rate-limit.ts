
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

export interface RateLimitStore {
  hit(key: string, now?: number): RateLimitResult;
}

export const WINDOW_MS: number = 60_000;
export const MAX_HITS: number = 20;

export function createMemoryRateLimitStore(opts?: { windowMs?: number; maxHits?: number }): RateLimitStore {
  const windowMs = opts?.windowMs ?? WINDOW_MS;
  const maxHits = opts?.maxHits ?? MAX_HITS;
  const hits = new Map<string, number[]>();

  return {
    hit(key: string, now: number = Date.now()): RateLimitResult {
      const cutoff = now - windowMs;
      const kept = (hits.get(key) ?? []).filter((t) => t > cutoff);
      if (kept.length === 0) hits.delete(key);
      kept.push(now);
      hits.set(key, kept);

      const allowed = kept.length <= maxHits;
      const remaining = Math.max(0, maxHits - kept.length);
      const resetMs = kept[0] + windowMs - now;

      return { allowed, remaining, resetMs };
    },
  };
}

let processStore: RateLimitStore | undefined;

export function getRateLimitStore(): RateLimitStore {
  if (!processStore) processStore = createMemoryRateLimitStore();
  return processStore;
}

export function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  if (first) return first;

  const real = req.headers.get('x-real-ip')?.trim();
  if (real) return real;

  return 'unknown';
}
