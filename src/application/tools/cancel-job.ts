import * as bodyRuntime from '../../platform/short-native-body-runtime.js';
import * as draftDirectory from '../../platform/short-draft-directory.js';
import * as trialRuntime from '../../platform/short-native-trial-runtime.js';
import * as z from 'zod/v4';
import { type Config } from '../../config.js';
import { AppError } from '../../errors.js';
import { RuntimeError } from '../../runtime/store.js';
import { JobQueue } from '../../runtime/jobs.js';
import { type ToolOperation } from '../contracts/tool-input.js';
import { type PublicJobOperation } from '../contracts/evidence-context.js';
import { type CompletedOperation } from '../contracts/query.js';
interface Dependencies {
  tool: ToolOperation;
  publicJob: PublicJobOperation;
  config: Config;
  completed: CompletedOperation;
  queue: JobQueue;
}

export function registerCancelJobTool(deps: Dependencies): void {
  deps.tool(
    'cancel_job',
    '请求持久取消任务；底层清理完成前保持账号锁，已开始写入的任务保留结果不确定。',
    z.object({ jobId: z.string().uuid() }).strict(),
    false,
    async (args) => {
      const job = deps.publicJob(String(args.jobId));
      if (!job || job.accountId !== deps.config.accountId)
        throw new AppError('not_found', 'Job not found', 404);
      try {
        return deps.completed(deps.queue.cancel(job.id));
      } catch (error) {
        if (
          bodyRuntime.hasReservedNativeShortBodySignal(job) ||
          draftDirectory.hasReservedShortDraftDirectorySignal(job)
        )
          return deps.completed(job);
        if (
          error instanceof RuntimeError &&
          error.code === 'capability_unavailable' &&
          trialRuntime.hasReservedNativeShortTrialSignal(job)
        )
          return deps.completed(job);
        throw error;
      }
    },
  );
}
