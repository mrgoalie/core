import { RateLimitedError } from "./errors";

/**
 * Fixed-window, in-memory rate limiter. Adequate for a single App Service instance.
 * When scaling out to several instances, put Azure Front Door / Application Gateway WAF
 * rate-limiting in front of the app as well (see docs/SECURITY-CHECKLIST.md).
 */
type Bucket = { count: number; resetAt: number };
const g = globalThis as unknown as { __fdaRate?: Map<string, Bucket> };
const buckets: Map<string, Bucket> = (g.__fdaRate ??= new Map());

export function checkRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  if (buckets.size > 50_000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  }
  if (b.count > limit) throw new RateLimitedError();
}

export function resetRateLimits() {
  buckets.clear();
}
