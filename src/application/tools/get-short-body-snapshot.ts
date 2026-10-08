import * as bodyRuntime from '../../platform/short-native-body-runtime.js';
import { NATIVE_SHORT_READ_DATASET } from '../../platform/short-native-metadata-proof.js';
import * as z from 'zod/v4';
import { type Config } from '../../config.js';
import { AppError } from '../../errors.js';
import { Store } from '../../runtime/store.js';
import { type ToolOperation } from '../contracts/tool-input.js';
import {
  type EnqueueNativeShortMetadataReadOperation,
  type CompletedOperation,
} from '../contracts/query.js';

interface Dependencies {
  tool: ToolOperation;
  enqueueNativeShortMetadataRead: EnqueueNativeShortMetadataReadOperation;
  completed: CompletedOperation;
  store: Store;
  config: Config;
}

export function registerGetShortBodySnapshotTool(deps: Dependencies): void {
  deps.tool(
    'get_short_body_snapshot',
    '显式只读本次本人短故事草稿当前作者编辑正文；只返回段落原文与版本，已发布版本未验证。通用任务和历史出口不返回正文。',
    z.object({ workId: z.string().regex(/^[1-9][0-9]{9,21}$/) }).strict(),
    true,
    async (args) => {
      const handle = deps.enqueueNativeShortMetadataRead(String(args.workId), true),
        job = await handle.completion;
      const response = deps.completed(job, 'live');
      if (job.status !== 'succeeded') return response;
      try {
        const actual = deps.store.getJob(job.id, deps.config.accountId),
          manifest = deps.store.getManifestForJob(deps.config.accountId, job.id),
          refs = deps.store.listEvidence(job.id);
        if (
          !actual ||
          !manifest ||
          refs.length !== 1 ||
          refs[0]!.dataset !== NATIVE_SHORT_READ_DATASET
        )
          throw Error('Incomplete body read context');
        const ref = refs[0]!,
          document = deps.store.readEvidence(ref);
        const bodySnapshot = bodyRuntime.projectNativeShortBodyReadContext({
          accountId: deps.config.accountId,
          job: actual,
          manifest,
          ref,
          document,
        });
        return { ...response, bodySnapshot };
      } catch {
        throw new AppError(
          'capability_unavailable',
          'Native short body snapshot is unavailable.',
          409,
        );
      }
    },
  );
}
