import {
  NATIVE_SHORT_HASH_BASES,
  type NativeShortBinding,
  type NativeShortMetadataSnapshot,
  type LegacyNativeShortMetadataSnapshot,
  type NativeShortMetadataRawInput,
  NATIVE_SHORT_SERVER_REVISION_POLICY_V2,
  type NativeShortServerRevision,
} from '../short-native-metadata.js';

import {
  NATIVE_SHORT_BODY_WORD_NUMBER_BASIS_V2,
  NATIVE_SHORT_BODY_COMPARISON_POLICY_V2,
  type NativeShortBodyWordNumberExpectationV2,
} from '../short-native-body-word-number.js';

import { reject } from './reject.js';

import {
  type NativeShortTrialMarkerAttributes,
  type NativeShortTrialDocument,
  type LegacyNativeShortTrialSnapshot,
} from '../short-native-trial.js';

/** Pure local data only: no owner, freshness, ACK, durability or save authority. */
export const NATIVE_SHORT_BODY_SCOPE = 'short-native-body/v1' as const;

export const NATIVE_SHORT_BODY_REPRESENTATION = 'native-plain-paragraph-vector/v1' as const;

export const NATIVE_SHORT_BODY_RESOURCE_LIMITS = Object.freeze({
  inputJsonBytes: 3 * 1024 * 1024,
  accountIdUtf8Bytes: 1024,
  depth: 64,
  nodes: 100_000,
});

export const NATIVE_SHORT_BODY_HASH_BASES = Object.freeze({
  snapshot: NATIVE_SHORT_HASH_BASES.snapshot,
  catalog: NATIVE_SHORT_HASH_BASES.catalog,
  document: NATIVE_SHORT_HASH_BASES.document,
  savedFields: NATIVE_SHORT_HASH_BASES.savedFields,
  categorySelection: NATIVE_SHORT_HASH_BASES.categorySelection,
  sourceVector: 'native-short-body-source-paragraph-vector/v1',
  submittedVector: 'native-short-body-submitted-provenance-vector/v1',
  effectiveWireVector: 'native-short-body-effective-wire-vector/v1',
  body: 'native-short-body-semantic-paragraph-lf-body/v1',
  paragraphs: 'native-short-body-ordered-exact-paragraph-html-utf8/v1',
  marker: 'native-short-body-exact-pay-marker/v1',
  covers: 'native-short-body-unchanged-full-source-cover-fields/v1',
  preservation: 'native-short-body-full-source-except-content-and-exact-server-revision-fields/v1',
  invalidRevisionPreservation: 'native-short-body-unmasked-invalid-server-revision/v1',
  desired: 'native-short-body-desired-form-and-preservation/v1',
  business: 'native-short-body-account-target-business-input/v1',
} as const);

export const NATIVE_SHORT_BODY_HASH_BASES_V2 = Object.freeze({
  ...NATIVE_SHORT_BODY_HASH_BASES,
  preservation:
    'native-short-body-full-source-except-content-exact-revision-and-validated-derived-word-number/v2',
  invalidRevisionPreservation: 'native-short-body-unmasked-invalid-server-revision/v2',
  desired: 'native-short-body-desired-form-preservation-and-derived-word-number/v2',
  business: 'native-short-body-account-target-business-input-and-policy/v2',
  derivedWordNumber: NATIVE_SHORT_BODY_WORD_NUMBER_BASIS_V2,
} as const);

export function nativeShortBodyHashBasesForRequest(request?: {
  readonly comparisonPolicy?: typeof NATIVE_SHORT_BODY_COMPARISON_POLICY_V2;
}) {
  if (request?.comparisonPolicy === undefined) return NATIVE_SHORT_BODY_HASH_BASES;
  if (request.comparisonPolicy !== NATIVE_SHORT_BODY_COMPARISON_POLICY_V2)
    reject('request_binding');
  return NATIVE_SHORT_BODY_HASH_BASES_V2;
}

export interface NativeShortBodyParagraphInput {
  readonly sourceIndex: number | null;
  readonly lines: readonly string[];
}

export interface NativeShortBodySourceParagraph {
  readonly sourceIndex: number;
  readonly lines: readonly string[];
  readonly rawHtml: string;
}

export interface NativeShortBodyWireParagraph {
  readonly lines: readonly string[];
  readonly rawHtml: string;
}

export type NativeShortBodyTrialPolicy =
  | { readonly action: 'preserve' }
  | { readonly action: 'clear' }
  | { readonly action: 'set'; readonly beforeParagraph: number };

export interface NativeShortBodyWriteRequest {
  readonly comparisonPolicy?: typeof NATIVE_SHORT_BODY_COMPARISON_POLICY_V2;
  readonly expectedSnapshotVersionHash: string;
  readonly hashBasis: typeof NATIVE_SHORT_HASH_BASES.snapshot;
  readonly expectedState: 'draft';
  readonly representation: typeof NATIVE_SHORT_BODY_REPRESENTATION;
  readonly paragraphs: readonly NativeShortBodyParagraphInput[];
  readonly trial: NativeShortBodyTrialPolicy;
}

export interface NativeShortBodyBusinessInput extends NativeShortBodyWriteRequest {
  readonly target: { readonly kind: 'short'; readonly workId: string };
  readonly snapshotScope: typeof NATIVE_SHORT_BODY_SCOPE;
}

export interface NativeShortBodyMarker {
  readonly rawHtml: string | null;
  readonly boundary: number | null;
  readonly attrs: NativeShortTrialMarkerAttributes | null;
}

export interface NativeShortBodySnapshot {
  readonly scope: typeof NATIVE_SHORT_BODY_SCOPE;
  readonly representation: typeof NATIVE_SHORT_BODY_REPRESENTATION;
  readonly hashBases: typeof NATIVE_SHORT_BODY_HASH_BASES;
  readonly binding: NativeShortBinding;
  readonly native: NativeShortMetadataSnapshot;
  readonly document: NativeShortTrialDocument;
  readonly sourceParagraphs: readonly NativeShortBodySourceParagraph[];
  readonly marker: NativeShortBodyMarker;
  readonly snapshotVersionHash: string;
  readonly catalogHash: string;
  readonly documentHash: string;
  readonly savedFieldsHash: string;
  readonly categorySelectionHash: string;
  readonly sourceVectorHash: string;
  readonly observedWireVectorHash: string;
  readonly bodyHash: string;
  readonly paragraphsHash: string;
  readonly markerHash: string;
  readonly coversHash: string;
}

/** @internal Historical source types are pure audit data, never write authority. */
export type LegacyNativeShortBodySnapshot = Omit<NativeShortBodySnapshot, 'native'> & {
  readonly native: LegacyNativeShortMetadataSnapshot;
};

export interface HistoricalBodyDependencies {
  readonly rebuildMetadata: (raw: NativeShortMetadataRawInput) => LegacyNativeShortMetadataSnapshot;
  readonly rebuildTrial: (
    native: LegacyNativeShortMetadataSnapshot,
  ) => LegacyNativeShortTrialSnapshot;
}

export type BodyNativeSource = NativeShortMetadataSnapshot | LegacyNativeShortMetadataSnapshot;

export type BodySource<N extends BodyNativeSource> = Omit<NativeShortBodySnapshot, 'native'> & {
  readonly native: N;
};

export interface BodyMathDependencies<N extends BodyNativeSource> {
  readonly rebuildMetadata: (raw: NativeShortMetadataRawInput) => N;
  readonly rebuildTrial: (native: N) => { readonly native: N };
  readonly rebuildMetadataFromSnapshot: (input: unknown) => N;
  readonly observedWordNumber: (native: N) => number;
  readonly wordNumberExpectation: (
    native: N,
    html: string,
  ) => NativeShortBodyWordNumberExpectationV2;
  readonly editable: (native: N) => boolean;
}

export interface NativeShortBodyExpectation {
  readonly scope: typeof NATIVE_SHORT_BODY_SCOPE;
  readonly representation: typeof NATIVE_SHORT_BODY_REPRESENTATION;
  readonly hashBases: typeof NATIVE_SHORT_BODY_HASH_BASES | typeof NATIVE_SHORT_BODY_HASH_BASES_V2;
  readonly derivedWordNumber?: NativeShortBodyWordNumberExpectationV2;
  readonly binding: NativeShortBinding;
  readonly expectedState: 'draft';
  readonly writeRequest: NativeShortBodyWriteRequest;
  readonly sourceVersionHash: string;
  readonly sourceDocumentHash: string;
  readonly sourceVectorHash: string;
  readonly expectedDocumentHash: string;
  readonly expectedSavedFieldsHash: string;
  readonly catalogHash: string;
  readonly categorySelectionHash: string;
  readonly preservationHash: string;
  readonly coversHash: string;
  readonly bodyHash: string;
  readonly paragraphsHash: string;
  readonly markerHash: string;
  readonly submittedVectorHash: string;
  readonly effectiveWireVectorHash: string;
  readonly effectiveWireParagraphs: readonly NativeShortBodyWireParagraph[];
  readonly appendedWireTerminal: boolean;
  readonly serverRevisionPolicy: typeof NATIVE_SHORT_SERVER_REVISION_POLICY_V2;
  readonly serverRevisionBefore: NativeShortServerRevision;
  readonly desiredHtml: string;
  readonly marker: NativeShortBodyMarker;
}

export interface NativeShortBodyPlan {
  readonly kind: 'native_body_payload_plan';
  readonly atomicRevision: false;
  readonly expectation: NativeShortBodyExpectation;
  readonly desiredContentHash: string;
  readonly form: Readonly<Record<string, string>>;
  readonly request: {
    readonly method: 'POST';
    readonly url: string;
    readonly contentType: string;
    readonly body: string;
  };
}

export type NativeShortBodyReason =
  | 'match'
  | 'binding_changed'
  | 'state_not_draft'
  | 'server_revision_not_proven'
  | 'derived_word_number_not_proven'
  | 'catalog_changed'
  | 'document_changed'
  | 'saved_fields_changed'
  | 'category_selection_changed'
  | 'preservation_not_proven'
  | 'covers_changed'
  | 'body_changed'
  | 'paragraphs_changed'
  | 'marker_changed'
  | 'wire_vector_changed';

export interface NativeShortBodyComparison {
  readonly matches: boolean;
  readonly reason: NativeShortBodyReason;
  readonly scope: typeof NATIVE_SHORT_BODY_SCOPE;
  readonly hashBases: typeof NATIVE_SHORT_BODY_HASH_BASES | typeof NATIVE_SHORT_BODY_HASH_BASES_V2;
  readonly actual: {
    readonly derivedWordNumber?: {
      readonly policy: typeof NATIVE_SHORT_BODY_WORD_NUMBER_BASIS_V2;
      readonly expected: number;
      readonly actual: number | null;
    };
    readonly snapshotVersionHash: string;
    readonly catalogHash: string;
    readonly documentHash: string;
    readonly savedFieldsHash: string;
    readonly categorySelectionHash: string;
    readonly preservationHash: string;
    readonly coversHash: string;
    readonly bodyHash: string;
    readonly paragraphsHash: string;
    readonly markerHash: string;
    readonly observedWireVectorHash: string;
    readonly serverRevisionPolicy: typeof NATIVE_SHORT_SERVER_REVISION_POLICY_V2;
    readonly serverRevisionBefore: NativeShortServerRevision;
    readonly serverRevisionAfter: NativeShortServerRevision | null;
  };
}

export type NativeShortBodyErrorCode =
  | 'json_resource_limit'
  | 'json_invalid_number'
  | 'json_invalid_value'
  | 'json_cycle'
  | 'json_non_plain'
  | 'json_symbol_key'
  | 'json_non_data_property'
  | 'json_sparse_or_extra_array'
  | 'json_extent_limit'
  | 'invalid_unicode'
  | 'object_shape'
  | 'unsupported_field'
  | 'derived_object_shape'
  | 'derived_array_shape'
  | 'account_id_invalid'
  | 'request_binding'
  | 'business_binding'
  | 'binding_shape'
  | 'paragraph_shape'
  | 'paragraph_lines'
  | 'literal_line_break'
  | 'source_index'
  | 'source_index_order'
  | 'source_index_missing'
  | 'trial_action'
  | 'trial_boundary'
  | 'trial_anchor_missing'
  | 'trial_min_text'
  | 'trial_min_paragraphs'
  | 'trial_ratio'
  | 'unsupported_entity'
  | 'invalid_entity_scalar'
  | 'unsupported_text'
  | 'document_extent_or_unicode'
  | 'document_grammar'
  | 'document_resource_limit'
  | 'marker_attributes'
  | 'multiple_markers'
  | 'marker_not_empty'
  | 'marker_derived_values'
  | 'snapshot_source_invalid'
  | 'body_snapshot_hash_mismatch'
  | 'source_version_mismatch'
  | 'state_not_draft'
  | 'wire_fields_unsupported'
  | 'server_revision_shape'
  | 'no_change'
  | 'expectation_shape'
  | 'expectation_scope'
  | 'expectation_hash'
  | 'expectation_document'
  | 'expectation_source_mismatch'
  | 'form_shape'
  | 'body_plan_hash_mismatch'
  | 'derived_word_number_invalid';
