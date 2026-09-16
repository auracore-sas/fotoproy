import { Injectable } from '@nestjs/common';

interface Window {
  count: number;
  resetAt: number;
}

export interface RateLimitVerdict {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Fixed-window rate limiter kept in memory.
 *
 * Why not `@nestjs/throttler`: its peer range stops at Nest 11 and this project
 * runs Nest 12, so the dependency cannot be installed safely. This class is the
 * whole feature: a counter per bucket+identity that resets every window.
 *
 * Trade-offs (documented in docs/deployment.md): state lives in the process, so
 * it resets on redeploy and is per instance. That is enough for the current
 * single-container deployment; a second replica would need a shared store.
 */
@Injectable()
export class RateLimitService {
  private readonly windows = new Map<string, Window>();
  private lastSweep = Date.now();

  /** Counts one hit and says whether the caller is still under the limit. */
  hit(key: string, limit: number, windowMs: number): RateLimitVerdict {
    const now = Date.now();
    this.sweep(now);

    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      return {
        allowed: true,
        remaining: Math.max(0, limit - 1),
        retryAfterSeconds: Math.ceil(windowMs / 1000),
      };
    }

    current.count += 1;
    const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    if (current.count > limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }
    return { allowed: true, remaining: Math.max(0, limit - current.count), retryAfterSeconds };
  }

  /** Drops expired windows so the map cannot grow without bound. */
  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) {
      return;
    }
    this.lastSweep = now;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) {
        this.windows.delete(key);
      }
    }
  }
}
