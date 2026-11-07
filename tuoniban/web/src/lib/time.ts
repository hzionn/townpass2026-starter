/**
 * All deadlines are decided by the server (spec §7.1), so countdowns run on the server's clock:
 * we remember how far the device clock is from `serverNow` and never trust the device on its own.
 */
const TAIPEI = 'Asia/Taipei';

export function createServerClock() {
  let offsetMs = 0;
  return {
    sync(serverNow: string): void {
      const parsed = Date.parse(serverNow);
      if (!Number.isNaN(parsed)) offsetMs = parsed - Date.now();
    },
    now(): number {
      return Date.now() + offsetMs;
    },
  };
}

export const serverClock = createServerClock();

export function remainingMs(expiresAt: string, nowMs: number): number {
  return Math.max(0, Date.parse(expiresAt) - nowMs);
}

/** mm:ss. Rounds up, so 00:00 appears only when the time has really run out. */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function taipeiParts(iso: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TAIPEI,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

/** 2026/11/07 14:20, always in Taipei time whatever the device is set to. */
export function formatTaipeiDateTime(iso: string): string {
  const p = taipeiParts(iso);
  return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}`;
}

/** 14:20, always in Taipei time. */
export function formatTaipeiTime(iso: string): string {
  const p = taipeiParts(iso);
  return `${p.hour}:${p.minute}`;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** A plain calendar date: 2026-11-08 becomes 2026/11/08（週日）. No time zone is involved. */
export function formatCalendarDate(date: string): string {
  const weekday = WEEKDAYS[new Date(`${date}T00:00:00.000Z`).getUTCDay()];
  return `${date.replaceAll('-', '/')}（週${weekday}）`;
}
