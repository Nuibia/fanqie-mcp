import { type BrowserContext, type Page, chromium } from 'playwright';
import { type PlatformIdentity } from '../own-identity.js';
import { BrowserSessionError } from '../errors.js';
import { type BrowserSessionConfig } from '../contracts.js';
import { recoverStaleProfileSingletons } from '../profile-locks.js';
import { type ObserveIdentityOperation } from '../contracts/observe-identity.js';
import { type EnsurePageOperation } from '../contracts/ensure-page.js';
interface Dependencies {
  apiQuarantined: boolean;
  closed: boolean;
  context: BrowserContext | null;
  config: BrowserSessionConfig;
  page: Page | null;
  observeIdentity: ObserveIdentityOperation;
  identityEpoch: number;
  identity: PlatformIdentity | null;
  qrLoginPage: Page | null;
}
export function createEnsurePage(deps: Dependencies): EnsurePageOperation {
  async function ensurePage(ownedInitialization = false): Promise<Page> {
    if (deps.apiQuarantined)
      throw new BrowserSessionError(
        'shutdown_incomplete',
        'Owned API disposal is unverified; the account session is quarantined',
      );
    if (deps.closed) throw new BrowserSessionError('browser_closed', 'Browser session is closed');
    if (!deps.context) {
      try {
        if (deps.config.recoverStaleProfileLocks) {
          await recoverStaleProfileSingletons(deps.config.profileDir, {
            assertProfileRecoveryLease: deps.config.assertProfileRecoveryLease!,
          });
        }
        deps.context = await chromium.launchPersistentContext(deps.config.profileDir, {
          headless: deps.config.headless,
          ...(deps.config.executablePath ? { executablePath: deps.config.executablePath } : {}),
          viewport: { width: 1280, height: 900 },
          locale: 'zh-CN',
          timezoneId: 'Asia/Shanghai',
        });
        deps.context.setDefaultTimeout(deps.config.timeoutMs ?? 20_000);
        deps.page = deps.context.pages()[0] ?? (await deps.context.newPage());
        deps.observeIdentity(deps.page);
      } catch (error) {
        // New submission lifecycle owns late initialization cleanup. Preserve
        // the resource for its explicit drain instead of swallowing close errors.
        if (ownedInitialization) {
          if (error instanceof BrowserSessionError) throw error;
          throw new BrowserSessionError(
            'browser_unavailable',
            'Persistent Chromium could not start; check browser installation, display and profile lock',
          );
        }
        await deps.context?.close().catch(() => undefined);
        deps.context = null;
        deps.page = null;
        if (error instanceof BrowserSessionError) throw error;
        throw new BrowserSessionError(
          'browser_unavailable',
          'Persistent Chromium could not start; check browser installation, display and profile lock',
        );
      }
    }
    if (!deps.page || deps.page.isClosed()) {
      deps.identityEpoch += 1;
      deps.identity = null;
      deps.qrLoginPage = null;
      deps.page = await deps.context.newPage();
      deps.observeIdentity(deps.page);
    }
    if (deps.closed) {
      if (ownedInitialization)
        throw new BrowserSessionError(
          'browser_closed',
          'Browser session closed while opening its page',
        );
      await deps.context.close().catch(() => undefined);
      deps.context = null;
      deps.page = null;
      throw new BrowserSessionError(
        'browser_closed',
        'Browser session closed while opening its page',
      );
    }
    return deps.page;
  }
  return ensurePage;
}
