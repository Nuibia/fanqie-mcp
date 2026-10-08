import * as submissionRuntime from '../../platform/short-native-submission-runtime.js';
import * as z from 'zod/v4';
import { type Config } from '../../config.js';
import { AppError } from '../../errors.js';
import { Store } from '../../runtime/store.js';
import * as writes from '../../platform/writes.js';
import { hash } from '../shared.js';
import { type ToolOperation } from '../contracts/tool-input.js';
import {
  type ExecuteNativeShortSubmissionWriteOperation,
  type ExecuteWriteOperation,
} from '../contracts/maintenance.js';
import { type RefsForOperation } from '../contracts/evidence-context.js';

interface Dependencies {
  tool: ToolOperation;
  submissionSchema: z.ZodObject<
    {
      expectedContentHash: z.ZodOptional<z.ZodString>;
      snapshotScope: z.ZodOptional<z.ZodString>;
      hashBasis: z.ZodOptional<z.ZodString>;
      expectedSnapshotVersionHash: z.ZodOptional<z.ZodString>;
      useAi: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>]>>;
      preparationJobId: z.ZodString;
      acceptPublicationTerms: z.ZodLiteral<true>;
      target: z.ZodObject<
        {
          kind: z.ZodEnum<{ short: 'short'; chapter: 'chapter' }>;
          workId: z.ZodString;
          chapterId: z.ZodOptional<z.ZodString>;
        },
        z.core.$strict
      >;
      expectedState: z.ZodEnum<{
        draft: 'draft';
        reviewing: 'reviewing';
        submitted: 'submitted';
        published: 'published';
        rejected: 'rejected';
      }>;
      idempotencyKey: z.ZodString;
    },
    z.core.$strict
  >;
  executeNativeShortSubmissionWrite: ExecuteNativeShortSubmissionWriteOperation;
  store: Store;
  config: Config;
  refsFor: RefsForOperation;
  executeWrite: ExecuteWriteOperation;
}

export function registerSubmissionTool(deps: Dependencies): void {
  for (const operation of ['submit_short_story', 'publish_chapter'] as const) {
    deps.tool(
      operation,
      '执行指定已准备版本的提交并回读；审核中不称发布成功，响应丢失先对账。',
      deps.submissionSchema,
      false,
      async (args) => {
        if (args.snapshotScope !== undefined) {
          if (operation !== 'submit_short_story')
            throw new AppError(
              'invalid_input',
              'Native short submission cannot publish a chapter',
              400,
            );
          const { idempotencyKey, ...raw } = args;
          const business = submissionRuntime.validateNativeShortSubmissionBusinessInput(raw);
          return deps.executeNativeShortSubmissionWrite(business, String(idempotencyKey));
        }
        if (
          !Object.hasOwn(args, 'expectedContentHash') ||
          args.hashBasis !== undefined ||
          args.expectedSnapshotVersionHash !== undefined ||
          args.useAi !== undefined
        )
          throw new AppError(
            'invalid_input',
            'Legacy submission requires its exact content version',
            400,
          );
        const preparation = deps.store.getJob(String(args.preparationJobId), deps.config.accountId);
        if (
          !preparation ||
          preparation.status !== 'succeeded' ||
          preparation.operation !== 'prepare_submission' ||
          preparation.accountId !== deps.config.accountId
        )
          throw new AppError(
            'invalid_preparation',
            'A completed service-side preparation is required',
            409,
          );
        const ref = deps.refsFor(preparation).find((item) => item.dataset === 'preparation');
        if (!ref) throw new AppError('invalid_preparation', 'Preparation evidence is missing', 409);
        const prepared = deps.store.readEvidence(ref).payload as writes.PreparedSubmission;
        const target = args.target as writes.WriteTarget;
        if (hash(prepared.target) !== hash(target))
          throw new AppError('invalid_preparation', 'Prepared target differs from request', 409);
        return deps.executeWrite(
          operation,
          args,
          operation === 'submit_short_story' ? 'short' : 'chapter',
          (page, _ctx, options, accountId) =>
            writes[operation === 'submit_short_story' ? 'submitShortStory' : 'publishChapter'](
              page,
              {
                accountId,
                target,
                expectedContentHash: String(args.expectedContentHash),
                expectedState: args.expectedState as writes.PlatformState,
                prepared,
                acceptPublicationTerms: true,
              },
              options,
            ),
        );
      },
    );
  }
}
