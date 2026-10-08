import { type Cookie } from 'playwright';

import { type OwnedStopSignal } from '../short-native-submission-api.js';
interface Ports {
  copy: <T>(input: T) => T;
  fields: (
    input: unknown,
    allowed: readonly string[],
    required?: readonly string[],
  ) => Record<string, unknown>;
  STOPPED: OwnedStopSignal;
}
export function createCookieCopy(ports: Ports) {
  return function cookieCopy(input: Cookie[]): Cookie[] {
    return ports
      .copy(input)
      .filter((cookie) => ['fanqienovel.com', '.fanqienovel.com'].includes(cookie.domain))
      .map((cookie) => {
        const c = ports.fields(
          cookie,
          [
            'name',
            'value',
            'domain',
            'path',
            'expires',
            'httpOnly',
            'secure',
            'sameSite',
            'partitionKey',
          ],
          ['name', 'value', 'domain', 'path', 'expires', 'httpOnly', 'secure', 'sameSite'],
        );
        if (
          ['name', 'value', 'domain', 'path'].some((k) => typeof c[k] !== 'string') ||
          typeof c.expires !== 'number' ||
          typeof c.httpOnly !== 'boolean' ||
          typeof c.secure !== 'boolean' ||
          !['Strict', 'Lax', 'None'].includes(String(c.sameSite)) ||
          (c.partitionKey !== undefined && typeof c.partitionKey !== 'string')
        )
          throw ports.STOPPED;
        return c as unknown as Cookie;
      });
  };
}
