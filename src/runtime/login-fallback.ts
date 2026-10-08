import { openSync, closeSync, fstatSync, readSync, constants } from 'node:fs';

export type LoginFallbackStatus = 'unknown' | 'starting' | 'available' | 'unavailable';
export interface LoginFallbackConfig {
  stateFile: string;
  instanceId: string;
}
export interface LoginFallbackState {
  status: LoginFallbackStatus;
  code: string;
  checkedAt: string | null;
}
export const loginFallbackFreshnessMs = 15_000;
const instancePattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const codes = {
  starting: ['checking'],
  available: ['verified'],
  unavailable: [
    'password_unavailable',
    'rfb_unavailable',
    'frontend_unavailable',
    'probe_failed',
    'worker_failed',
  ],
} as const;
const unknown = (code: string): LoginFallbackState => ({
  status: 'unknown',
  code,
  checkedAt: null,
});

/** This is current management-channel availability, separate from platform login. */
export function readLoginFallback(
  config?: LoginFallbackConfig,
  now = Date.now(),
): LoginFallbackState {
  if (!config || !instancePattern.test(config.instanceId)) return unknown('not_configured');
  let descriptor: number | undefined;
  try {
    descriptor = openSync(config.stateFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = fstatSync(descriptor);
    if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > 2_048)
      return unknown('state_invalid');
    const bytes = Buffer.alloc(2_049);
    const size = readSync(descriptor, bytes, 0, bytes.length, 0);
    if (size > 2_048) return unknown('state_invalid');
    const state: unknown = JSON.parse(bytes.subarray(0, size).toString('utf8'));
    if (!state || typeof state !== 'object' || Array.isArray(state))
      return unknown('state_invalid');
    const value = state as Record<string, unknown>;
    if (
      Object.keys(value).length !== 5 ||
      Object.keys(value).some(
        (key) => !['schemaVersion', 'instanceId', 'status', 'code', 'checkedAt'].includes(key),
      ) ||
      value.schemaVersion !== 1
    )
      return unknown('state_invalid');
    if (value.instanceId !== config.instanceId) return unknown('state_mismatch');
    if (!['starting', 'available', 'unavailable'].includes(String(value.status)))
      return unknown('state_invalid');
    const status = value.status as keyof typeof codes;
    if (!(codes[status] as readonly unknown[]).includes(value.code))
      return unknown('state_invalid');
    if (
      typeof value.checkedAt !== 'string' ||
      !Number.isFinite(Date.parse(value.checkedAt)) ||
      new Date(value.checkedAt).toISOString() !== value.checkedAt
    )
      return unknown('state_invalid');
    const age = now - Date.parse(value.checkedAt);
    if (age < -1_000 || age > loginFallbackFreshnessMs) return unknown('state_expired');
    return { status, code: String(value.code), checkedAt: value.checkedAt };
  } catch {
    return unknown('state_unreadable');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
