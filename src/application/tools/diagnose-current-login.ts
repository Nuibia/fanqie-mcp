import { type Config } from '../../config.js';
import { JobQueue } from '../../runtime/jobs.js';
import { BrowserSession } from '../../platform/browser.js';
import { datasets, empty, jsonValue } from '../shared.js';
import { type ToolOperation } from '../contracts/tool-input.js';
import { type WaitOperation } from '../contracts/query.js';
interface Dependencies {
  tool: ToolOperation;
  wait: WaitOperation;
  queue: JobQueue;
  config: Config;
  browser: BrowserSession;
}

export function registerDiagnoseCurrentLoginTool(deps: Dependencies): void {
  deps.tool(
    'diagnose_current_login',
    '只读检查服务当前登录页/扫码后的首页结构，不导航、不返回账号值、正文、二维码或凭据；供排查登录身份识别。',
    empty,
    true,
    async () =>
      deps.wait(
        deps.queue.enqueueRead({
          accountId: deps.config.accountId,
          operation: 'diagnose_current_login',
          scope: 'login_diagnostic',
          datasets: ['login_diagnostic'],
          run: async (ctx) => {
            ctx.beforePlatformRead();
            return [
              ctx.saveEvidence(
                'login_diagnostic',
                jsonValue(
                  await deps.browser.diagnoseCurrentLoginPage({
                    signal: ctx.signal,
                    maxElements: 300,
                    maxResponses: 100,
                  }),
                ),
              ),
            ];
          },
        }),
      ),
  );
}
