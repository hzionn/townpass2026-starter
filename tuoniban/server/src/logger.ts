/**
 * Everything the server logs goes through this interface, so one test can assert that
 * nothing sensitive is ever logged (spec AT11). Pass only low-risk fields: method, route
 * pattern, status, duration, error name and code. Never bodies, tokens, cookies, phone
 * numbers, filenames or database error details.
 */
export type LogFields = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

function line(level: string, event: string, fields?: LogFields): string {
  return JSON.stringify({ level, event, ...fields });
}

export const consoleLogger: Logger = {
  info: (event, fields) => console.log(line('info', event, fields)),
  warn: (event, fields) => console.warn(line('warn', event, fields)),
  error: (event, fields) => console.error(line('error', event, fields)),
};

/** Error name and code are safe to log. The message is not: a driver may put values in it. */
export function safeErrorFields(err: unknown): LogFields {
  const { name, code } = (err ?? {}) as { name?: unknown; code?: unknown };
  return {
    errorName: typeof name === 'string' ? name : 'unknown',
    errorCode: typeof code === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : undefined,
  };
}
