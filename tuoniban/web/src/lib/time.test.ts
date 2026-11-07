import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createServerClock,
  formatCalendarDate,
  formatCountdown,
  formatTaipeiDateTime,
  formatTaipeiTime,
  remainingMs,
} from './time';

afterEach(() => {
  vi.useRealTimers();
});

describe('countdown', () => {
  it('shows mm:ss like the wireframe', () => {
    expect(formatCountdown(582_000)).toBe('09:42');
    expect(formatCountdown(10 * 60_000)).toBe('10:00');
    expect(formatCountdown(60 * 60_000)).toBe('60:00');
  });

  it('rounds up, so 00:00 only appears when time is really up', () => {
    expect(formatCountdown(500)).toBe('00:01');
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(-5000)).toBe('00:00');
  });

  it('measures the remaining time against a given now, never below zero', () => {
    const now = Date.parse('2026-11-07T06:00:00Z');
    expect(remainingMs('2026-11-07T06:10:00Z', now)).toBe(600_000);
    expect(remainingMs('2026-11-07T05:59:00Z', now)).toBe(0);
  });
});

describe('server clock', () => {
  it('follows serverNow rather than the device clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-07T06:00:00Z')); // The device is 5 minutes behind.
    const clock = createServerClock();
    clock.sync('2026-11-07T06:05:00Z');
    expect(new Date(clock.now()).toISOString()).toBe('2026-11-07T06:05:00.000Z');

    vi.advanceTimersByTime(1000);
    expect(new Date(clock.now()).toISOString()).toBe('2026-11-07T06:05:01.000Z');
  });

  it('ignores an unparseable serverNow', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-07T06:00:00Z'));
    const clock = createServerClock();
    clock.sync('not a date');
    expect(new Date(clock.now()).toISOString()).toBe('2026-11-07T06:00:00.000Z');
  });
});

describe('Taipei formatting', () => {
  it('shows times in Asia/Taipei whatever the device zone is', () => {
    expect(formatTaipeiDateTime('2026-11-07T06:20:00Z')).toBe('2026/11/07 14:20');
    expect(formatTaipeiTime('2026-11-07T06:20:00Z')).toBe('14:20');
  });

  it('crosses midnight at 16:00 UTC', () => {
    expect(formatTaipeiDateTime('2026-11-07T16:30:00Z')).toBe('2026/11/08 00:30');
  });

  it('shows a calendar date with its weekday', () => {
    expect(formatCalendarDate('2026-11-08')).toBe('2026/11/08（週日）');
    expect(formatCalendarDate('2026-11-09')).toBe('2026/11/09（週一）');
  });
});
