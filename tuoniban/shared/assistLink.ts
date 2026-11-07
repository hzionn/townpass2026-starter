/**
 * The assist link format from spec v1.3 §5 S03: `<PUBLIC_ORIGIN>/assist#token=<opaque-token>`.
 *
 * The token sits in the URL fragment so it never reaches server logs or Referer headers.
 * Parsing is deliberately strict: QR codes and pasted text are untrusted input, so we
 * never navigate to them and never send an arbitrary URL to the backend (spec §4.2).
 */

/** 32 random bytes in base64url, unpadded. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const ASSIST_PATH = '/assist';
const MAX_LINK_LENGTH = 512;

export function buildAssistLink(publicOrigin: string, token: string): string {
  return `${publicOrigin}${ASSIST_PATH}#token=${token}`;
}

/** Reads a token out of a fragment such as `#token=abc`. Rejects anything extra. */
export function tokenFromFragment(fragment: string): string | null {
  const match = /^#token=([^&=#]*)$/.exec(fragment);
  const token = match?.[1];
  return token !== undefined && TOKEN_PATTERN.test(token) ? token : null;
}

export type AssistLinkParseResult = { ok: true; token: string } | { ok: false };

/**
 * Accepts only a full link to this site's assist page with exactly one well-formed token.
 * Bare tokens are refused on purpose: there is no hand-typed short-code system (spec §5 S03).
 */
export function parseAssistLink(raw: unknown, publicOrigin: string): AssistLinkParseResult {
  if (typeof raw !== 'string') return { ok: false };
  const text = raw.trim();
  if (text === '' || text.length > MAX_LINK_LENGTH) return { ok: false };

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false };
  }

  if (url.origin !== publicOrigin) return { ok: false };
  if (url.username !== '' || url.password !== '') return { ok: false };
  if (url.pathname !== ASSIST_PATH || url.search !== '') return { ok: false };

  const token = tokenFromFragment(url.hash);
  return token === null ? { ok: false } : { ok: true, token };
}
