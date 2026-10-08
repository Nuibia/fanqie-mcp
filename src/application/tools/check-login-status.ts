import { type Config } from '../../config.js';
import { JobQueue } from '../../runtime/jobs.js';
import { datasets, empty } from '../shared.js';
import { type ToolOperation } from '../contracts/tool-input.js';
import { type WaitOperation } from '../contracts/query.js';
import { type CheckLoginOperation } from '../contracts/identity.js';
interface Dependencies {
  tool: ToolOperation;
  wait: WaitOperation;
  queue: JobQueue;
  config: Config;
  checkLogin: CheckLoginOperation;
}

export function registerCheckLoginStatusTool(deps: Dependencies): void {
  deps.tool(
    'check_login_status',
    '实际访问番茄检查服务持有的账号登录状态并保存本次证据。',
    empty,
    true,
    async () =>
      deps.wait(
        deps.queue.enqueueRead({
          accountId: deps.config.accountId,
          operation: 'check_login',
          scope: 'login',
          datasets: ['login'],
          run: async (ctx) => [ctx.saveEvidence('login', await deps.checkLogin(ctx))],
        }),
      ),
  );
}
