import type { Clock } from '../clock.js';

/**
 * A simple in-memory fixed window, keyed by session rather than IP, because phones at the
 * venue share one IP. On Vercel each instance counts separately, which is fine for slowing
 * down a runaway client. Guessing a 256-bit token was never feasible anyway.
 */
export class FixedWindowLimiter {
  readonly #windows = new Map<string, { startedAt: number; count: number }>();
  readonly #max: number;
  readonly #windowMs: number;
  readonly #clock: Clock;

  constructor(max: number, windowMs: number, clock: Clock) {
    this.#max = max;
    this.#windowMs = windowMs;
    this.#clock = clock;
  }

  /** Counts one attempt. Returns false once this key is over the limit for the window. */
  take(key: string): boolean {
    const now = this.#clock.now().getTime();
    const current = this.#windows.get(key);
    if (!current || now - current.startedAt >= this.#windowMs) {
      this.#forgetFinishedWindows(now);
      this.#windows.set(key, { startedAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= this.#max;
  }

  #forgetFinishedWindows(now: number): void {
    for (const [key, window] of this.#windows) {
      if (now - window.startedAt >= this.#windowMs) this.#windows.delete(key);
    }
  }
}
