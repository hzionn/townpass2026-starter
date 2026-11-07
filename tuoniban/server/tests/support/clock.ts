import type { Clock } from '../../src/clock.js';

/** A clock tests move by hand, to reach expiry boundaries exactly (spec AT12). */
export class FakeClock implements Clock {
  #ms: number;

  constructor(iso: string) {
    this.#ms = Date.parse(iso);
  }

  now(): Date {
    return new Date(this.#ms);
  }

  set(iso: string): void {
    this.#ms = Date.parse(iso);
  }

  advanceMs(ms: number): void {
    this.#ms += ms;
  }

  advanceMinutes(minutes: number): void {
    this.advanceMs(minutes * 60_000);
  }
}
