import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { DEFAULT_MAX_UPLOAD_BYTES, VERCEL_BODY_LIMIT_BYTES, VERCEL_MAX_UPLOAD_BYTES } from './constants.js';

/** A problem the operator must fix. main.ts prints the message without a stack trace. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export type StorageConfig =
  | { kind: 'sqlite'; databasePath: string; uploadDir: string }
  | { kind: 'postgres'; databaseUrl: string };

export interface RateLimitConfig {
  windowMs: number;
  redeemMax: number;
  uploadMax: number;
}

export interface AppConfig {
  port: number;
  /** The only origin that may change data, and the only origin QR codes may point at. */
  publicOrigin: string;
  cookieSecure: boolean;
  sessionSecret: string;
  maxUploadBytes: number;
  /** Built web app to serve, or null when something else serves it (Vite, Vercel). */
  staticDir: string | null;
  trustProxy: number | false;
  rateLimit: RateLimitConfig;
  /** Local debugging only: adds error messages to logs. They could contain submitted values. */
  debugErrors: boolean;
  storage: StorageConfig;
  /** Things the operator should know. The caller logs them, so loadConfig stays pure. */
  warnings: string[];
}

export interface LoadConfigOptions {
  /** Web build to serve when STATIC_DIR is unset and it exists. Set by main.ts when bundled. */
  defaultStaticDir?: string | null;
  cwd?: string;
}

type Env = Record<string, string | undefined>;

const LOCAL_VITE_ORIGIN = 'http://localhost:5173';
const DEFAULT_PORT = 8787;
const MIN_SECRET_LENGTH = 16;

/** An empty value counts as unset, because `.env` files are often copied with blanks. */
function reader(env: Env): (name: string) => string | undefined {
  return (name) => env[name]?.trim() || undefined;
}

function positiveInteger(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ConfigError(`${name} must be a positive whole number.`);
  }
  return parsed;
}

function isSameOrInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

/** The part of the config the reset command needs, so it works without any app settings. */
export function loadStorageConfig(env: Env, cwd: string = process.cwd()): StorageConfig {
  const read = reader(env);
  const databaseUrl = read('DATABASE_URL');
  if (databaseUrl) {
    if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
      throw new ConfigError('DATABASE_URL must start with postgres:// or postgresql://.');
    }
    return { kind: 'postgres', databaseUrl };
  }
  return {
    kind: 'sqlite',
    databasePath: resolve(cwd, read('DATABASE_PATH') ?? '.data/tuoniban.db'),
    uploadDir: resolve(cwd, read('PRIVATE_UPLOAD_DIR') ?? '.data/uploads'),
  };
}

function resolveStaticDir(read: ReturnType<typeof reader>, options: LoadConfigOptions, cwd: string): string | null {
  const explicit = read('STATIC_DIR');
  if (explicit) {
    const dir = resolve(cwd, explicit);
    if (!existsSync(join(dir, 'index.html'))) {
      throw new ConfigError('STATIC_DIR has no index.html. Run `npm run build:web` first.');
    }
    return dir;
  }
  if (options.defaultStaticDir) {
    const dir = resolve(cwd, options.defaultStaticDir);
    if (existsSync(join(dir, 'index.html'))) return dir;
  }
  return null;
}

function resolvePublicOrigin(
  read: ReturnType<typeof reader>,
  production: boolean,
  port: number,
  staticDir: string | null,
): string {
  const vercelHost = read('VERCEL') && read('VERCEL_PROJECT_PRODUCTION_URL');
  const raw = read('PUBLIC_ORIGIN') ?? (vercelHost ? `https://${vercelHost}` : undefined);
  if (raw === undefined) {
    if (production) {
      throw new ConfigError('PUBLIC_ORIGIN is required in production, for example https://example.com.');
    }
    return staticDir ? `http://localhost:${port}` : LOCAL_VITE_ORIGIN;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError('PUBLIC_ORIGIN must be a full URL, for example https://example.com.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ConfigError('PUBLIC_ORIGIN must start with http:// or https://.');
  }
  return url.origin;
}

/** Reads settings from the environment. Fails with a clear message rather than running misconfigured. */
export function loadConfig(env: Env = process.env, options: LoadConfigOptions = {}): AppConfig {
  const read = reader(env);
  const cwd = options.cwd ?? process.cwd();
  const production = read('NODE_ENV') === 'production';
  const onVercel = read('VERCEL') !== undefined;
  const onCloudRun = read('K_SERVICE') !== undefined;
  const warnings: string[] = [];

  const demoMode = read('DEMO_MODE');
  if (demoMode !== 'true' && (production || demoMode !== undefined)) {
    throw new ConfigError('DEMO_MODE must be "true". This app only runs as a demo on fictional data (spec §13.1).');
  }

  const port = positiveInteger('PORT', read('PORT'), DEFAULT_PORT);
  const staticDir = resolveStaticDir(read, options, cwd);
  const publicOrigin = resolvePublicOrigin(read, production, port, staticDir);
  const https = publicOrigin.startsWith('https:');

  let sessionSecret = read('SESSION_SECRET');
  if (sessionSecret && sessionSecret.length < MIN_SECRET_LENGTH) {
    throw new ConfigError(`SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`);
  }
  if (!sessionSecret) {
    if (production || https) {
      throw new ConfigError('SESSION_SECRET is required in production or when PUBLIC_ORIGIN is https.');
    }
    sessionSecret = randomBytes(32).toString('hex');
    warnings.push('SESSION_SECRET is not set: using a random one, so sessions end when the server restarts.');
  }

  const maxUploadBytes = positiveInteger(
    'MAX_UPLOAD_BYTES',
    read('MAX_UPLOAD_BYTES'),
    onVercel ? VERCEL_MAX_UPLOAD_BYTES : DEFAULT_MAX_UPLOAD_BYTES,
  );
  if (onVercel && maxUploadBytes >= VERCEL_BODY_LIMIT_BYTES) {
    warnings.push('MAX_UPLOAD_BYTES is above what Vercel accepts: larger uploads get a non-JSON platform error.');
  }

  const storage = loadStorageConfig(env, cwd);
  if (storage.kind === 'sqlite') {
    if (onVercel) {
      throw new ConfigError('Vercel has no persistent disk. Set DATABASE_URL to a Postgres database.');
    }
    if (onCloudRun) {
      warnings.push(
        'NO DATABASE_URL ON CLOUD RUN: the filesystem is in memory, so all demo data is lost on every restart.',
      );
    }
    if (staticDir) {
      if (isSameOrInside(staticDir, storage.uploadDir)) {
        throw new ConfigError('PRIVATE_UPLOAD_DIR must not be inside the static web directory.');
      }
      if (isSameOrInside(staticDir, storage.databasePath)) {
        throw new ConfigError('DATABASE_PATH must not be inside the static web directory.');
      }
    }
  }

  return {
    port,
    publicOrigin,
    cookieSecure: https,
    sessionSecret,
    maxUploadBytes,
    staticDir,
    trustProxy: read('TRUST_PROXY') ? positiveInteger('TRUST_PROXY', read('TRUST_PROXY'), 1) : onVercel || onCloudRun ? 1 : false,
    rateLimit: {
      windowMs: 60_000,
      redeemMax: positiveInteger('RATE_LIMIT_REDEEM_PER_MINUTE', read('RATE_LIMIT_REDEEM_PER_MINUTE'), 30),
      uploadMax: positiveInteger('RATE_LIMIT_UPLOAD_PER_MINUTE', read('RATE_LIMIT_UPLOAD_PER_MINUTE'), 20),
    },
    debugErrors: read('DEBUG_ERRORS') === 'true',
    storage,
    warnings,
  };
}
