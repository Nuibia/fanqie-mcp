import { type BrowserContext } from 'playwright';

import { PlatformReadError } from '../../reads.js';
import { BrowserSessionError } from '../errors.js';

import { type ChapterReadState } from './chapterReadScope.js';

interface Ports {
  chapterReadScope: ChapterReadState;
  ownedRequest: import('../../../../node_modules/playwright/index.js').APIRequestContext;
}
export function createDirectoryRead(ports: Ports) {
  return async (source: string): Promise<unknown> => {
    let ownedResponse: Awaited<ReturnType<BrowserContext['request']['get']>> | undefined;
    let value: unknown,
      disposed = false;
    ports.chapterReadScope.assertStable();
    try {
      ownedResponse = await ports.ownedRequest.get(source, {
        maxRedirects: 0,
        maxRetries: 0,
        failOnStatusCode: false,
        timeout: ports.chapterReadScope.timeout,
        ...(ports.chapterReadScope.options.signal
          ? { signal: ports.chapterReadScope.options.signal }
          : {}),
      });
      ports.chapterReadScope.assertStable();
      if (
        ownedResponse.url() !== source ||
        !ownedResponse.ok() ||
        ownedResponse.status() < 200 ||
        ownedResponse.status() >= 300
      )
        throw new PlatformReadError(
          'chapter_context_response_unverified',
          'A current directory GET did not return its exact successful response',
        );
      ports.chapterReadScope.assertStable();
      value = await ownedResponse.json();
      ports.chapterReadScope.assertStable();
    } finally {
      if (ownedResponse) {
        let stale = false;
        try {
          ports.chapterReadScope.assertStable();
        } catch {
          stale = true;
        }
        try {
          await ownedResponse.dispose();
          disposed = true;
        } catch {
          throw new PlatformReadError(
            'chapter_context_disposal_failed',
            'A current directory response was not disposed',
          );
        }
        ports.chapterReadScope.assertStable();
        if (stale)
          throw new BrowserSessionError(
            'read_diagnostic_stale',
            'The current chapter document changed',
          );
      }
    }
    ports.chapterReadScope.assertStable();
    if (!disposed)
      throw new PlatformReadError(
        'chapter_context_disposal_failed',
        'A current directory response was not disposed',
      );
    return value;
  };
}
