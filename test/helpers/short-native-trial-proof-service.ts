import { createHash } from 'node:crypto';

// Synthetic, offline proof fixtures. Live-labelled structure is not verified-live evidence.
export const SERVICE = 'trial-proof-fixture',
  OWNER = '987654321',
  WORK = '7412345678901234567';

export const HTML = [100, 100, 100, 100]
  .map((count, i) => `<p>${String.fromCharCode(65 + i).repeat(count)}</p>`)
  .join('');

export const live = { executor: 'application-default-browser/v1' as const, mode: 'live' as const },
  fixture = { executor: 'dependency-injected-browser/v1' as const, mode: 'fixture' as const };

export const sha = (value: string) => createHash('sha256').update(value).digest('hex'),
  clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export const roots: string[] = [];
