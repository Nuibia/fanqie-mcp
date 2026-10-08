import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { LoginFallbackConfig } from './runtime/login-fallback.js';

export interface Config {
  host: string;
  port: number;
  token: string;
  dataDir: string;
  profileDir: string;
  runtimeDir: string;
  uploadDir: string;
  accountId: string;
  headless: boolean;
  writesEnabled: boolean;
  allowedHosts: Set<string>;
  allowedOrigins: Set<string>;
  bodyLimit: number;
  timeoutMs: number;
  writeProfilePath?: string;
  readProfilePath?: string;
  recoverStaleProfileLocks?: boolean;
  loginFallback?: LoginFallbackConfig;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.FANQIE_PORT ?? 18062);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid FANQIE_PORT');
  const token = env.FANQIE_TOKEN_FILE
    ? readFileSync(env.FANQIE_TOKEN_FILE, 'utf8').trim()
    : env.FANQIE_TOKEN?.trim();
  if (!token || token.length < 24)
    throw new Error('Set FANQIE_TOKEN_FILE or a token of at least 24 characters');
  const dataDir = path.resolve(env.FANQIE_DATA_DIR ?? '.runtime/data');
  const profileDir = path.resolve(env.FANQIE_PROFILE_DIR ?? '.runtime/profile');
  const runtimeDir = path.resolve(env.FANQIE_RUNTIME_DIR ?? '.runtime/state');
  const uploadDir = path.join(dataDir, 'uploads');
  for (const dir of [dataDir, profileDir, runtimeDir, uploadDir])
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  const timeoutMs = Number(env.FANQIE_TIMEOUT_MS ?? 120_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000)
    throw new Error('Invalid FANQIE_TIMEOUT_MS');
  return {
    host: env.FANQIE_HOST ?? '127.0.0.1',
    port,
    token,
    dataDir,
    profileDir,
    runtimeDir,
    uploadDir,
    accountId: env.FANQIE_ACCOUNT_ID ?? 'owner',
    headless: env.FANQIE_HEADLESS !== 'false',
    writesEnabled: env.FANQIE_ENABLE_WRITES === 'true',
    allowedHosts: new Set(
      (env.FANQIE_ALLOWED_HOSTS ?? 'localhost,127.0.0.1,[::1],fanqie-mcp')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
    allowedOrigins: new Set(
      (env.FANQIE_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
    bodyLimit: 4 * 1024 * 1024,
    timeoutMs,
    writeProfilePath: env.FANQIE_WRITE_PROFILE,
    readProfilePath: env.FANQIE_READ_PROFILE,
    recoverStaleProfileLocks: env.FANQIE_RECOVER_PROFILE_LOCKS === 'true',
    ...(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      env.FANQIE_LOGIN_FALLBACK_INSTANCE ?? '',
    )
      ? {
          loginFallback: {
            stateFile: '/run/fanqie/login-fallback.json',
            instanceId: env.FANQIE_LOGIN_FALLBACK_INSTANCE!,
          },
        }
      : {}),
  };
}
