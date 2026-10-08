import * as bodyModel from '../../platform/short-native-body.js';
import { NATIVE_SHORT_HASH_BASES } from '../../platform/short-native-metadata.js';
import * as z from 'zod/v4';
import { hashSchema, writeBase } from '../shared.js';
import { type ToolOperation } from '../contracts/tool-input.js';
import { type ExecuteNativeShortBodyWriteOperation } from '../contracts/maintenance.js';
interface Dependencies {
  tool: ToolOperation;
  bodyTrialSchema: z.ZodDiscriminatedUnion<
    [
      z.ZodObject<{ action: z.ZodLiteral<'preserve'> }, z.core.$strict>,
      z.ZodObject<{ action: z.ZodLiteral<'clear'> }, z.core.$strict>,
      z.ZodObject<{ action: z.ZodLiteral<'set'>; beforeParagraph: z.ZodNumber }, z.core.$strict>,
    ],
    'action'
  >;
  executeNativeShortBodyWrite: ExecuteNativeShortBodyWriteOperation;
}

export function registerUpdateShortBodyTool(deps: Dependencies): void {
  deps.tool(
    'update_short_body',
    '按本次完整草稿版本保存原生纯文本段落向量及试读策略；保存时显式传 comparisonPolicy=native-short-body-derived-word-number/v2，核验平台派生字数。持久去重、一次POST并回读。未知结果只读对账，不能重发保存。',
    z
      .object({
        ...writeBase,
        target: z
          .object({ kind: z.literal('short'), workId: z.string().regex(/^[1-9][0-9]{9,21}$/) })
          .strict(),
        snapshotScope: z.literal(bodyModel.NATIVE_SHORT_BODY_SCOPE),
        comparisonPolicy: z.literal('native-short-body-derived-word-number/v2').optional(),
        expectedSnapshotVersionHash: hashSchema,
        hashBasis: z.literal(NATIVE_SHORT_HASH_BASES.snapshot),
        expectedState: z.literal('draft'),
        representation: z.literal(bodyModel.NATIVE_SHORT_BODY_REPRESENTATION),
        paragraphs: z.array(
          z
            .object({
              sourceIndex: z.number().int().min(0).nullable(),
              lines: z.array(z.string()).min(1),
            })
            .strict(),
        ),
        trial: deps.bodyTrialSchema,
      })
      .strict(),
    false,
    async (args) => {
      const { idempotencyKey, ...business } = args;
      return deps.executeNativeShortBodyWrite(
        bodyModel.validateNativeShortBodyBusinessInput(business),
        String(idempotencyKey),
      );
    },
  );
}
