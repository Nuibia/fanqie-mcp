import { type Page } from 'playwright';
import { type PlatformIdentity, type LoginState, parseOwnIdentity } from '../own-identity.js';
import { BrowserSessionError } from '../errors.js';
import { WRITER_HOME } from '../contracts.js';
import { type RememberIdentityOperation } from '../contracts/remember-identity.js';
import { type InspectLoginOperation } from '../contracts/inspect-login.js';
interface Dependencies {
  identityEpoch: number;
  page: Page | null;
  closed: boolean;
  identity: PlatformIdentity | null;
  rememberIdentity: RememberIdentityOperation;
}
export function createInspectLogin(deps: Dependencies): InspectLoginOperation {
  async function inspectLogin(page: Page, allowCachedIdentity = true): Promise<LoginState> {
    const epoch = deps.identityEpoch;
    let sourceUrl = WRITER_HOME;
    try {
      const url = new URL(page.url());
      if (url.origin !== 'https://fanqienovel.com' || !/^\/main\/writer(?:\/|$)/.test(url.pathname))
        return {
          status: 'unknown',
          identity: null,
          sourceUrl: WRITER_HOME,
          checkedAt: new Date().toISOString(),
          reason: 'Current page is outside the trusted official writer routes',
        };
      sourceUrl = `${url.origin}${url.pathname}`;
    } catch {
      return {
        status: 'unknown',
        identity: null,
        sourceUrl: WRITER_HOME,
        checkedAt: new Date().toISOString(),
        reason: 'Current page has no trusted official writer source',
      };
    }
    const observed = await page
      .evaluate(() => {
        const text = document.body?.innerText ?? '';
        const loginRequired =
          /扫码登录|手机号登录|验证码登录|登录后(?:查看|使用)/.test(text) ||
          /\/(?:login|passport)(?:\/|$)/.test(location.pathname);
        const managementVisible = Boolean(
          document.querySelector('a[href*="/main/writer/preview-short/"]'),
        );
        const routerData = (window as unknown as { _ROUTER_DATA?: unknown })._ROUTER_DATA;
        const ownAccount = (value: unknown): Record<string, unknown> | null => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
          const object = value as Record<string, unknown>;
          for (const key of [
            'userInfo',
            'user_info',
            'authorInfo',
            'author_info',
            'accountInfo',
            'account_info',
            'writerInfo',
            'writer_info',
          ]) {
            const candidate = object[key];
            if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
              const account = candidate as Record<string, unknown>;
              // Return just identity fields; never serialize the account envelope or session data.
              return Object.fromEntries(
                [
                  'user_id',
                  'userId',
                  'account_id',
                  'accountId',
                  'author_id',
                  'authorId',
                  'writer_id',
                  'writerId',
                  'author_name',
                  'authorName',
                  'pen_name',
                  'penName',
                  'nickname',
                ]
                  .filter(
                    (field) =>
                      typeof account[field] === 'string' || typeof account[field] === 'number',
                  )
                  .map((field) => [field, account[field]]),
              );
            }
          }
          for (const key of ['data', 'loaderData']) {
            const envelope = object[key];
            if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) continue;
            const direct = ownAccount(envelope);
            if (direct) return direct;
            if (key === 'loaderData')
              for (const route of Object.values(envelope)) {
                const identity = ownAccount(route);
                if (identity) return identity;
              }
          }
          return null;
        };
        return { loginRequired, managementVisible, ownAccount: ownAccount(routerData) };
      })
      .catch(() => {
        throw new BrowserSessionError(
          'login_status_unavailable',
          'Current platform login status could not be inspected',
        );
      });
    const checkedAt = new Date().toISOString();
    let sameTrustedSource = false;
    try {
      const source = new URL(page.url());
      sameTrustedSource =
        source.origin === 'https://fanqienovel.com' &&
        `${source.origin}${source.pathname}` === sourceUrl;
    } catch {
      /* Unknown source is never accepted as account identity. */
    }
    if (
      !sameTrustedSource ||
      epoch !== deps.identityEpoch ||
      page !== deps.page ||
      page.isClosed() ||
      deps.closed
    )
      return {
        status: 'unknown',
        identity: null,
        sourceUrl,
        checkedAt,
        reason: 'The login document changed during inspection',
      };
    if (observed.loginRequired) {
      deps.identity = null;
      return {
        status: 'login_required',
        identity: null,
        sourceUrl,
        checkedAt,
        reason: 'Platform login page or login prompt is visible',
      };
    }
    const routed = parseOwnIdentity(observed.ownAccount, `${sourceUrl}#own-account`);
    if (routed) deps.rememberIdentity(routed);
    const identity =
      routed?.accountId || routed?.authorId ? routed : allowCachedIdentity ? deps.identity : routed;
    if (identity?.accountId || identity?.authorId)
      return { status: 'authenticated', identity, sourceUrl, checkedAt };
    return {
      status: 'unknown',
      identity: null,
      sourceUrl,
      checkedAt,
      reason:
        observed.managementVisible || identity?.displayName
          ? 'Writer UI is visible but no stable own-account identity has been verified'
          : 'No stable own-account identity or authenticated management element is visible',
    };
  }
  return inspectLogin;
}
