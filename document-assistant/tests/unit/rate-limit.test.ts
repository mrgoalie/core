import { afterEach, describe, expect, it, vi } from "vitest";
import { RateLimitedError } from "@/server/errors";
import { checkRateLimit, resetRateLimits } from "@/server/rate-limit";

afterEach(() => {
  vi.useRealTimers();
  resetRateLimits();
});

describe("rate limiter", () => {
  it("allows requests up to the limit, then refuses until the window resets", () => {
    vi.useFakeTimers();
    for (let i = 0; i < 3; i++) checkRateLimit("upload:user-1", 3, 60_000);
    expect(() => checkRateLimit("upload:user-1", 3, 60_000)).toThrow(RateLimitedError);
    expect(() => checkRateLimit("upload:user-2", 3, 60_000)).not.toThrow();
    vi.advanceTimersByTime(60_001);
    expect(() => checkRateLimit("upload:user-1", 3, 60_000)).not.toThrow();
  });
});
