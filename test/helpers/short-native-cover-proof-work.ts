import { createHash } from 'node:crypto';

export const WORK = '7000000001',
  OWNER = '0001001',
  SERVICE = 'synthetic-cover-service';

export const HTML = '<p>SYNTHETIC PRIVATE BODY &amp; + %</p>',
  URI = 'synthetic/private-recommended&+%',
  URL = 'synthetic-private-opaque-url';

export const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export const live = { executor: 'application-default-browser/v1', mode: 'live' } as const;

export const fixtureProvenance = {
  executor: 'dependency-injected-browser/v1',
  mode: 'fixture',
} as const;
