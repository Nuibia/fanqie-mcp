import { type Config } from '../../config.js';
import { JobQueue } from '../../runtime/jobs.js';
import { readLoginFallback } from '../../runtime/login-fallback.js';
import { BrowserSession, type LoginState } from '../../platform/browser.js';
import { datasets, empty, jsonValue } from '../shared.js';
import { type ToolOperation } from '../contracts/tool-input.js';
import { type WaitOperation } from '../contracts/query.js';
import { type BindIdentityOperation } from '../contracts/identity.js';
interface Dependencies {
  tool: ToolOperation;
  wait: WaitOperation;
  queue: JobQueue;
  config: Config;
  login: LoginState | null;
  browser: BrowserSession;
  bindIdentity: BindIdentityOperation;
}

export function registerStartLoginTool(deps: Dependencies): void {
  deps.tool(
    'start_login',
    '打开服务持有的番茄登录浏览器；人工完成扫码或验证后再次检查登录。',
    empty,
    true,
    async () => {
      const result = await deps.wait(
        deps.queue.enqueueRead({
          accountId: deps.config.accountId,
          operation: 'start_login',
          scope: 'login',
          datasets: ['login'],
          run: async (ctx) => {
            ctx.beforePlatformRead();
            deps.login = await deps.browser.startLogin({ signal: ctx.signal });
            deps.bindIdentity(deps.login);
            return [ctx.saveEvidence('login', jsonValue(deps.login))];
          },
        }),
      );
      const loginFallback = readLoginFallback(deps.config.loginFallback);
      return {
        ...result,
        login: result.data[0] ?? null,
        loginFallback,
        ...(loginFallback.status === 'available'
          ? { managementUrl: 'http://127.0.0.1:18063/vnc.html' }
          : {}),
        screenshotEndpoint: '/api/v1/login/screenshot',
      };
    },
  );
}
