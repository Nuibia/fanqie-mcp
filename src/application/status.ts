import { type Config } from '../config.js';
import { Store } from '../runtime/store.js';
import { readLoginFallback } from '../runtime/login-fallback.js';
import { BrowserSession, type LoginState } from '../platform/browser.js';
import { type StatusOperation } from './contracts/capabilities.js';

interface Dependencies {
  store: Store;
  config: Config;
  browser: BrowserSession;
  login: LoginState | null;
}

export function createStatus(deps: Dependencies): StatusOperation {
  function status() {
    try {
      return deps.store.withPublicProjectionRead(deps.config.accountId, 'status', () => {
        let runtimeStatus: 'ready' | 'unavailable' = 'ready';
        try {
          deps.store.assertLeaseOwnership();
        } catch {
          runtimeStatus = 'unavailable';
        }
        if (deps.browser.hasUnsafeApiCleanup === true) runtimeStatus = 'unavailable';
        const jobCounts: Record<string, number> = {};
        try {
          for (const job of deps.store.listJobsForPublicProjection(deps.config.accountId))
            jobCounts[job.status] = (jobCounts[job.status] ?? 0) + 1;
        } catch {
          runtimeStatus = 'unavailable';
        }
        return {
          service: 'fanqie-mcp',
          version: '0.1.0',
          status: runtimeStatus,
          loginFallback: readLoginFallback(deps.config.loginFallback),
          platform: {
            status: deps.login?.status ?? 'unknown',
            checkedAt: deps.login?.checkedAt ?? null,
          },
          writesEnabled: deps.config.writesEnabled,
          jobCounts,
        };
      });
    } catch {
      return {
        service: 'fanqie-mcp',
        version: '0.1.0',
        status: 'unavailable' as const,
        loginFallback: readLoginFallback(deps.config.loginFallback),
        platform: {
          status: deps.login?.status ?? 'unknown',
          checkedAt: deps.login?.checkedAt ?? null,
        },
        writesEnabled: deps.config.writesEnabled,
        jobCounts: {} as Record<string, number>,
      };
    }
  }
  return status;
}
