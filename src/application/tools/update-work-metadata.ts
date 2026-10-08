import * as trialRuntime from '../../platform/short-native-trial-runtime.js';
import * as coverRuntime from '../../platform/short-native-cover-runtime.js';
import {
  validateNativeShortWriteBusinessInput,
  type NativeShortWriteBusinessInput,
} from '../../platform/short-native-metadata-proof.js';
import * as z from 'zod/v4';
import { type Config } from '../../config.js';
import { AppError } from '../../errors.js';
import * as writes from '../../platform/writes.js';
import {
  metadataTargetSchema,
  stateSchema,
  hashSchema,
  writeBase,
  NATIVE_SHORT_PUBLIC_SAVE_READY,
  record,
} from '../shared.js';
import { type ToolOperation } from '../contracts/tool-input.js';
import {
  type ExecuteNativeShortTrialWriteOperation,
  type ExecuteNativeShortCoverWriteOperation,
  type ExecuteNativeShortMetadataWriteOperation,
  type ExecuteBookMetadataWriteOperation,
  type ExecuteWriteOperation,
} from '../contracts/maintenance.js';

interface Dependencies {
  tool: ToolOperation;
  config: Config;
  executeNativeShortTrialWrite: ExecuteNativeShortTrialWriteOperation;
  executeNativeShortCoverWrite: ExecuteNativeShortCoverWriteOperation;
  executeNativeShortMetadataWrite: ExecuteNativeShortMetadataWriteOperation;
  executeBookMetadataWrite: ExecuteBookMetadataWriteOperation;
  executeWrite: ExecuteWriteOperation;
}

export function registerUpdateWorkMetadataTool(deps: Dependencies): void {
  deps.tool(
    'update_work_metadata',
    '维护平台可编辑字段并回读；原生试读只允许独立set/clear段落边界补丁，封面须受控上传；long-book仅作品信息，expectedContentHash对应独立metadataHash，不创建长篇、读写正文或提交。',
    z
      .object({
        ...writeBase,
        expectedState: stateSchema,
        expectedContentHash: hashSchema.optional(),
        target: metadataTargetSchema,
        metadata: z.record(z.string(), z.unknown()).optional(),
        title: z.string().optional(),
        snapshotScope: z.string().optional(),
        hashBasis: z.string().optional(),
        expectedSnapshotVersionHash: hashSchema.optional(),
      })
      .strict(),
    false,
    async (args) => {
      if (trialRuntime.hasReservedNativeShortTrialSignal(args)) {
        if (!deps.config.writesEnabled)
          throw new AppError(
            'writes_disabled',
            'Platform writes are disabled for this deployment',
            403,
          );
        const { idempotencyKey: _key, ...businessInput } = args;
        let business: trialRuntime.NativeShortTrialBusinessInput;
        try {
          const externalKeys = [
            'target',
            'snapshotScope',
            'hashBasis',
            'expectedSnapshotVersionHash',
            'expectedState',
            'metadata',
          ];
          if (
            Object.keys(businessInput).length !== externalKeys.length ||
            Object.keys(businessInput).some((key) => !externalKeys.includes(key))
          )
            throw new Error('Invalid trial request');
          const metadata = businessInput.metadata;
          if (
            !metadata ||
            typeof metadata !== 'object' ||
            Array.isArray(metadata) ||
            Object.keys(metadata).length !== 1 ||
            !Object.hasOwn(metadata, 'trial')
          )
            throw new Error('Invalid trial patch');
          business = trialRuntime.validateNativeShortTrialBusinessInput(businessInput);
        } catch {
          throw new AppError(
            'invalid_input',
            'Native short trial requires an exact draft version and one paragraph-boundary action',
            400,
          );
        }
        return deps.executeNativeShortTrialWrite(business, String(args.idempotencyKey));
      }
      if (coverRuntime.hasReservedNativeShortCoverSignal(args)) {
        if (!deps.config.writesEnabled)
          throw new AppError(
            'writes_disabled',
            'Platform writes are disabled for this deployment',
            403,
          );
        const { idempotencyKey: _key, ...businessInput } = args;
        let business: coverRuntime.NativeShortCoverBusinessInput;
        try {
          const externalKeys = [
            'target',
            'snapshotScope',
            'hashBasis',
            'expectedSnapshotVersionHash',
            'expectedState',
            'metadata',
          ];
          if (
            Object.keys(businessInput).length !== externalKeys.length ||
            Object.keys(businessInput).some((key) => !externalKeys.includes(key))
          )
            throw new Error('Invalid cover request');
          const metadata = businessInput.metadata;
          if (
            !metadata ||
            typeof metadata !== 'object' ||
            Array.isArray(metadata) ||
            Object.keys(metadata).length !== 1 ||
            !Object.hasOwn(metadata, 'cover')
          )
            throw new Error('Invalid cover patch');
          const { metadata: _metadata, ...sourceVersion } = businessInput;
          business = coverRuntime.validateNativeShortCoverBusinessInput({
            ...sourceVersion,
            cover: (metadata as Record<string, unknown>).cover,
          });
        } catch {
          throw new AppError(
            'invalid_input',
            'Native short cover requires an exact draft version and one controlled image reference',
            400,
          );
        }
        return deps.executeNativeShortCoverWrite(business, String(args.idempotencyKey));
      }
      const native = ['snapshotScope', 'hashBasis', 'expectedSnapshotVersionHash'].some((name) =>
        Object.hasOwn(args, name),
      );
      if (native) {
        const { idempotencyKey: _key, ...businessInput } = args;
        let business: NativeShortWriteBusinessInput;
        try {
          business = validateNativeShortWriteBusinessInput(businessInput);
        } catch {
          throw new AppError(
            'invalid_input',
            'Native short metadata requires an exact version, target and nonempty supported patch',
            400,
          );
        }
        if (!NATIVE_SHORT_PUBLIC_SAVE_READY)
          throw new AppError(
            'capability_unavailable',
            'Native short metadata saving is unavailable',
            409,
          );
        return deps.executeNativeShortMetadataWrite(business, String(args.idempotencyKey));
      }
      if (
        !Object.hasOwn(args, 'expectedContentHash') ||
        typeof args.expectedContentHash !== 'string' ||
        !Object.hasOwn(args, 'metadata') ||
        args.metadata === undefined
      )
        throw new AppError(
          'invalid_input',
          'Legacy metadata maintenance requires expectedContentHash and metadata',
          400,
        );
      if ((args.target as writes.LongBookMetadataTarget).kind === 'long-book')
        return deps.executeBookMetadataWrite(args);
      return deps.executeWrite(
        'update_work_metadata',
        args,
        (args.target as writes.WriteTarget).kind,
        (page, _ctx, options, accountId) =>
          writes.updateWorkMetadata(
            page,
            {
              accountId,
              target: args.target as writes.WriteTarget,
              expectedContentHash: String(args.expectedContentHash),
              expectedState: args.expectedState as writes.PlatformState,
              metadata: args.metadata as writes.DraftMetadata,
              title: args.title as string | undefined,
            },
            options,
          ),
      );
    },
  );
}
