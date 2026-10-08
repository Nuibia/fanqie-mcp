/** Versioned pure derived-field policy. No runtime, save, owner, or durability authority. */
import { createHash } from 'node:crypto';
import { type NativeShortMetadataSnapshot } from './short-native-metadata.js';
import { parseNativeShortTrialDocument } from './short-native-trial.js';
export const NATIVE_SHORT_BODY_COMPARISON_POLICY_V2 =
  'native-short-body-derived-word-number/v2' as const;
export const NATIVE_SHORT_BODY_WORD_NUMBER_BASIS_V2 =
  'native-short-body-official-character-count-word-number/v2' as const;
export interface NativeShortBodyWordNumberExpectationV2 {
  readonly policy: typeof NATIVE_SHORT_BODY_WORD_NUMBER_BASIS_V2;
  readonly before: number;
  readonly desired: number;
  readonly beforeDocumentHash: string;
  readonly desiredDocumentHash: string;
}
function invalid(): never {
  throw new Error('Native short body derived word number is unverified.');
}
const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
export function nativeShortBodyDesiredWordNumberV2(rawHtml: string): number {
  return parseNativeShortTrialDocument(rawHtml).characterCount;
}
/** Caller supplies a reconstructed metadata snapshot. Reading a captured own data property is still mandatory. */
export function nativeShortBodyObservedWordNumberV2(native: NativeShortMetadataSnapshot): number {
  const d = Object.getOwnPropertyDescriptor(native.editData, 'word_number'),
    value = d && Object.hasOwn(d, 'value') ? d.value : undefined;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    value < 0 ||
    value !== nativeShortBodyDesiredWordNumberV2(native.savedFields.content)
  )
    invalid();
  return value;
}
export function nativeShortBodyWordNumberExpectationV2(
  native: NativeShortMetadataSnapshot,
  desiredHtml: string,
): NativeShortBodyWordNumberExpectationV2 {
  return Object.freeze({
    policy: NATIVE_SHORT_BODY_WORD_NUMBER_BASIS_V2,
    before: nativeShortBodyObservedWordNumberV2(native),
    desired: nativeShortBodyDesiredWordNumberV2(desiredHtml),
    beforeDocumentHash: digest(native.savedFields.content),
    desiredDocumentHash: digest(desiredHtml),
  });
}
