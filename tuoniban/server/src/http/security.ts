import type { RequestHandler } from 'express';
import { apiError } from '../errors.js';
import type { Logger } from '../logger.js';

/** Sent with every response, including the static web app. */
export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; " +
  "script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export const COMMON_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(self), microphone=()',
};

export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.set(COMMON_SECURITY_HEADERS);
  res.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  next();
};

export const noStore: RequestHandler = (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection (IMPLEMENTATION.md): a request that changes data must come from our own
 * origin. Browsers always send Origin on these requests and scripts cannot forge it. A wrong
 * PUBLIC_ORIGIN makes every write fail here, which is the most common deployment mistake.
 */
export function originCheck(publicOrigin: string, logger?: Logger): RequestHandler {
  // Each foreign origin is logged once, so the deployer sees the mistake without a flood.
  const reported = new Set<string>();
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    const origin = req.get('origin');
    const sameOrigin = origin !== undefined ? origin === publicOrigin : req.get('sec-fetch-site') === 'same-origin';
    if (!sameOrigin && origin !== undefined && !reported.has(origin) && reported.size < 20) {
      reported.add(origin);
      logger?.warn('origin_mismatch', { receivedOrigin: origin, publicOrigin, hint: 'Is PUBLIC_ORIGIN set to the URL phones open?' });
    }
    next(sameOrigin ? undefined : apiError('ACTION_FORBIDDEN'));
  };
}
