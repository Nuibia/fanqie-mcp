import { type BrowserContext, type Page } from 'playwright';
import {
  type PlatformIdentity,
  ownInfoSource,
  parseOwnResponseIdentity,
  type LoginState,
} from '../own-identity.js';
import { BrowserSessionError } from '../errors.js';
import { CANONICAL_OWN_USER_URL } from '../contracts.js';
import { type AssertAccountUsableOperation } from '../contracts/assert-account-usable.js';
import { type OwnsPageSlotOperation } from '../contracts/owns-page-slot.js';
import { type WithPageOperation } from '../contracts/with-page.js';
import { type VerifyCurrentAccountOperation } from '../contracts/verify-current-account.js';
import { type InspectLoginOperation } from '../contracts/inspect-login.js';

interface Dependencies {
  assertAccountUsable: AssertAccountUsableOperation;
  context: BrowserContext | null;
  ownsPageSlot: OwnsPageSlotOperation;
  withPage: WithPageOperation;
  verifyCurrentAccount: VerifyCurrentAccountOperation;
  identityEpoch: number;
  inspectLogin: InspectLoginOperation;
  ownInfoUrls: WeakMap<Page, Set<string>>;
  identity: PlatformIdentity | null;
}
export function createVerifyCurrentAccount(deps: Dependencies): VerifyCurrentAccountOperation {
  async function verifyCurrentAccount(page: Page): Promise<LoginState> {
    deps.assertAccountUsable();
    if (!deps.context || page.context() !== deps.context || page.isClosed())
      throw new BrowserSessionError(
        'invalid_browser_page',
        'Account verification requires the current service-owned page',
      );
    if (!deps.ownsPageSlot(page)) {
      // Idle/public calls join the FIFO. Only the same async service reader may reenter.
      return deps.withPage((current) => {
        if (current !== page)
          throw new BrowserSessionError(
            'invalid_browser_page',
            'Account verification requires the current service-owned page',
          );
        return deps.verifyCurrentAccount(current);
      });
    }
    const epoch = deps.identityEpoch;
    const current = await deps.inspectLogin(page, false);
    const changed = (): boolean => !deps.ownsPageSlot(page) || epoch !== deps.identityEpoch;
    const stale = (): LoginState => ({
      status: 'unknown',
      identity: null,
      sourceUrl: current.sourceUrl,
      checkedAt: new Date().toISOString(),
      reason: 'The current account document changed during identity verification',
    });
    if (changed()) return stale();
    if (current.status === 'login_required') return current;
    try {
      const source = new URL(page.url());
      if (
        source.origin !== 'https://fanqienovel.com' ||
        !/^\/main\/writer(?:\/|$)/.test(source.pathname)
      )
        return current;
    } catch {
      return current;
    }
    // SPA history transitions may invalidate request-generation caches after the page's own XHR starts.
    // This exact source was independently verified; no target/nonce/query is needed or replayed.
    const urls = [
      CANONICAL_OWN_USER_URL,
      ...[...(deps.ownInfoUrls.get(page) ?? [])]
        .slice(-5)
        .reverse()
        .filter((raw) => {
          try {
            const source = new URL(raw);
            return ownInfoSource(source) && source.pathname !== '/api/user/info/v2';
          } catch {
            return false;
          }
        }),
    ];
    for (const raw of urls) {
      const source = new URL(raw);
      const response = await page
        .evaluate(async (url) => {
          const response = await fetch(url, {
            method: 'GET',
            credentials: 'same-origin',
            redirect: 'error',
          });
          return {
            status: response.status,
            ok: response.ok,
            json: await response.json().catch(() => null),
          };
        }, raw)
        .catch(() => {
          throw new BrowserSessionError(
            'account_verification_unavailable',
            'The current own-account endpoint could not be verified safely',
          );
        });
      if (changed()) return stale();
      if (response.status === 401) {
        deps.identity = null;
        return {
          status: 'login_required',
          identity: null,
          sourceUrl: `${source.origin}${source.pathname}`,
          checkedAt: new Date().toISOString(),
          reason: 'Current own-account API requires login',
        };
      }
      const envelope =
        response.json && typeof response.json === 'object'
          ? (response.json as Record<string, unknown>)
          : {};
      if (!response.ok || (envelope.code !== undefined && envelope.code !== 0)) continue;
      const identity = parseOwnResponseIdentity(response.json, raw);
      if (identity?.accountId || identity?.authorId) {
        deps.identity = identity;
        return {
          status: 'authenticated',
          identity,
          sourceUrl: `${source.origin}${source.pathname}`,
          checkedAt: new Date().toISOString(),
        };
      }
    }
    return {
      ...current,
      status: 'unknown',
      reason: 'The current page has no freshly verified stable own-account ID',
    };
  }
  return verifyCurrentAccount;
}
