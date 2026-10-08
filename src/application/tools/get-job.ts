import * as z from 'zod/v4';
import { type Config } from '../../config.js';
import { AppError } from '../../errors.js';
import { type ToolOperation } from '../contracts/tool-input.js';
import { type PublicJobOperation } from '../contracts/evidence-context.js';
import { type CompletedOperation } from '../contracts/query.js';
interface Dependencies {
  tool: ToolOperation;
  publicJob: PublicJobOperation;
  config: Config;
  completed: CompletedOperation;
}

export function registerGetJobTool(deps: Dependencies): void {
  deps.tool(
    'get_job',
    '读取本服务账号的持久任务与本轮证据。',
    z.object({ jobId: z.string().uuid() }).strict(),
    true,
    async (args) => {
      const job = deps.publicJob(String(args.jobId));
      if (!job || job.accountId !== deps.config.accountId)
        throw new AppError('not_found', 'Job not found', 404);
      return deps.completed(job, 'saved', 'creation-event');
    },
  );
}
