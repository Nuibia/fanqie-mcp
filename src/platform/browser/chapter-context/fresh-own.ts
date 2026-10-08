import { type BrowserContext } from 'playwright';
import { parseOwnResponseIdentity } from '../own-identity.js';

import { BrowserSessionError } from '../errors.js';
import { CANONICAL_OWN_USER_URL } from '../contracts.js';

import { currentChapterHttpCategory } from '../chapter-dom.js';
import { type ChapterReadState } from './chapterReadScope.js';

interface Ports {
  chapterReadScope: ChapterReadState;
  ownedRequest: import('../../../../node_modules/playwright/index.js').APIRequestContext;
}
export function createFreshOwn(ports: Ports) {
  return async (
    phase: 'before' | 'after',
  ): Promise<{
    kind: 'account';
    id: string;
  } | null> => {
    let ownResponse: Awaited<ReturnType<BrowserContext['request']['get']>> | undefined;
    let owner: {
        kind: 'account';
        id: string;
      } | null = null,
      disposed = false;
    ports.chapterReadScope.assertStable();
    try {
      ports.chapterReadScope.diagnostic.ownAccountContext.attempts = (ports.chapterReadScope
        .diagnostic.ownAccountContext.attempts + 1) as 1 | 2;
      ownResponse = await ports.ownedRequest.get(CANONICAL_OWN_USER_URL, {
        maxRedirects: 0,
        maxRetries: 0,
        failOnStatusCode: false,
        timeout: ports.chapterReadScope.timeout,
        ...(ports.chapterReadScope.options.signal
          ? { signal: ports.chapterReadScope.options.signal }
          : {}),
      });
      ports.chapterReadScope.assertStable();
      const status = ownResponse.status();
      if (ports.chapterReadScope.collection)
        ports.chapterReadScope.collection.failureMetadata.ownAccountContext[
          phase === 'before' ? 'responseBefore' : 'responseAfter'
        ] = currentChapterHttpCategory(status);
      if (Number.isInteger(status) && status >= 100 && status <= 599) {
        ports.chapterReadScope.diagnostic.ownAccountContext[
          phase === 'before' ? 'responseStatusBefore' : 'responseStatusAfter'
        ] = status;
        if (
          ownResponse.url() === CANONICAL_OWN_USER_URL &&
          ownResponse.ok() &&
          status >= 200 &&
          status < 300
        ) {
          ports.chapterReadScope.assertStable();
          const value: unknown = await ownResponse.json();
          ports.chapterReadScope.assertStable();
          const identity =
            value !== null &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            (
              value as {
                code?: unknown;
              }
            ).code === 0
              ? parseOwnResponseIdentity(value, CANONICAL_OWN_USER_URL)
              : null;
          if (ports.chapterReadScope.collection)
            ports.chapterReadScope.collection.failureMetadata.identityTypes[
              phase === 'before' ? 'beforeParsedAccountIdPresent' : 'afterParsedAccountIdPresent'
            ] = Boolean(identity?.accountId);
          if (identity?.accountId) owner = { kind: 'account', id: identity.accountId };
        }
      }
    } catch {
      ports.chapterReadScope.assertStable();
      owner = null;
    } finally {
      if (ownResponse) {
        // Disposal is required even when the document has already become stale.
        let staleBeforeDispose = false;
        try {
          ports.chapterReadScope.assertStable();
        } catch {
          staleBeforeDispose = true;
        }
        try {
          await ownResponse.dispose();
          disposed = true;
          ports.chapterReadScope.diagnostic.ownAccountContext.disposed = (ports.chapterReadScope
            .diagnostic.ownAccountContext.disposed + 1) as 1 | 2;
        } catch {
          owner = null;
        }
        ports.chapterReadScope.assertStable();
        if (staleBeforeDispose)
          throw new BrowserSessionError(
            'read_diagnostic_stale',
            'The context probe document changed',
          );
      }
    }
    ports.chapterReadScope.assertStable();
    return disposed ? owner : null;
  };
}
