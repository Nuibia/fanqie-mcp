import {
  type NativeShortEvidenceContext,
  validateNativeShortEvidenceContext,
} from '../short-native-metadata-proof.js';

import { type NativeShortBodyReadProjection } from './project-native-short-body-evidence-context.js';

import { fail, storedNative, type Json } from './fail.js';

import { type EvidenceDocument } from '../../runtime/store.js';

import { hasReservedNativeShortBodySignal, physicalCanonical } from './native-short-body-scope.js';

import { createHash } from 'node:crypto';

import { resolveShortEditorStatus } from '../short-status.js';

/** App supplies this invocation's actual SQL job/manifest/ref and Store-read physical document. */
export function projectNativeShortBodyReadContext(
  context: NativeShortEvidenceContext,
): NativeShortBodyReadProjection {
  try {
    // Capture without evaluating getters before the metadata envelope's strict validator.
    const descriptor =
      context && typeof context === 'object'
        ? Object.getOwnPropertyDescriptor(context, 'document')
        : undefined;
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value'))
      fail('durability_unverified');
    const document = descriptor.value as EvidenceDocument;
    const payload =
      document && typeof document === 'object'
        ? Object.getOwnPropertyDescriptor(document, 'payload')
        : undefined;
    if (!payload?.enumerable || !Object.hasOwn(payload, 'value')) fail('durability_unverified');
    const wrapper = validateNativeShortEvidenceContext(payload.value, context);
    if (
      hasReservedNativeShortBodySignal(context) ||
      context.job!.error !== null ||
      context.job!.cancellationRequestedAt !== null ||
      context.job!.cancellationReason !== null
    )
      fail('durability_unverified');
    const metadata = wrapper.result.snapshot;
    if (!metadata) fail('durability_unverified');
    const decoded = storedNative({
        binding: metadata.binding,
        editData: metadata.editData,
        categoryData: metadata.categoryData,
        ...(Object.hasOwn(metadata, 'statusFacts')
          ? { statusFacts: Object.getOwnPropertyDescriptor(metadata, 'statusFacts')!.value }
          : {}),
      }),
      snapshot = decoded.snapshot;
    // The old state checks only the historical authenticated body-read contract.
    // Current facts are independently derived for public observation.
    if (
      (decoded.mode === 'legacy'
        ? decoded.snapshot.native.state !== 'draft'
        : !decoded.snapshot.native.statusFacts.draftEditable) ||
      context.document.collectionMode !== wrapper.source.mode
    )
      fail('durability_unverified');
    const physicalHash = createHash('sha256')
      .update(physicalCanonical(context.document as unknown as Json) + '\n', 'utf8')
      .digest('hex');
    if (
      physicalHash !== context.ref.sha256 ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(context.ref.id)
    )
      fail('durability_unverified');
    const phase = wrapper.result.proof,
      stamps = [
        phase.readStartedAt,
        phase.readFinishedAt,
        phase.proofCapturedAt,
        context.ref.capturedAt,
        context.manifest!.committedAt,
      ],
      now = new Date().toISOString();
    if (stamps.some((at) => at === null || new Date(at).toISOString() !== at || at > now))
      fail('durability_unverified');
    const facts = resolveShortEditorStatus(snapshot.native.editData);
    const paragraphs = Object.freeze(
      snapshot.sourceParagraphs.map((paragraph) =>
        Object.freeze({
          sourceIndex: paragraph.sourceIndex,
          lines: Object.freeze([...paragraph.lines]),
        }),
      ),
    );
    // Fixed scalar whitelist: raw source/HTML, URI, binding and runtime account fields never escape.
    return Object.freeze({
      schema: 'fanqie-short-native-body-snapshot/v1',
      status: 'success',
      snapshotScope: snapshot.scope,
      representation: snapshot.representation,
      hashBasis: snapshot.hashBases.snapshot,
      hashBases: snapshot.hashBases,
      state: facts.resolvedState,
      statusFacts: facts,
      statusSource: Object.freeze({
        phase: 'read' as const,
        sourceRef: context.ref.id,
        evidenceHash: context.ref.sha256,
        evidenceCapturedAt: context.ref.capturedAt,
      }),
      expectedState: 'draft',
      versionScope: 'author-edit-current',
      publishedVersionVerified: false,
      snapshotVersionHash: snapshot.snapshotVersionHash,
      catalogHash: snapshot.catalogHash,
      documentHash: snapshot.documentHash,
      savedFieldsHash: snapshot.savedFieldsHash,
      categorySelectionHash: snapshot.categorySelectionHash,
      sourceVectorHash: snapshot.sourceVectorHash,
      observedWireVectorHash: snapshot.observedWireVectorHash,
      bodyHash: snapshot.bodyHash,
      paragraphsHash: snapshot.paragraphsHash,
      markerHash: snapshot.markerHash,
      coversHash: snapshot.coversHash,
      paragraphs,
      marker: Object.freeze({
        boundary: snapshot.marker.boundary,
        markerCount: snapshot.document.markerCount,
        paragraphCount: snapshot.document.paragraphCount,
        eligibleParagraphCount: snapshot.document.eligibleParagraphCount,
        characterCount: snapshot.document.characterCount,
        prefixCharacterCount: snapshot.document.prefixCharacterCount,
        displayPercent: snapshot.document.displayPercent,
      }),
      sourceRef: context.ref.id,
      evidenceHash: context.ref.sha256,
      capturedAt: context.ref.capturedAt,
      readStartedAt: phase.readStartedAt!,
      readFinishedAt: phase.readFinishedAt!,
      proofCapturedAt: phase.proofCapturedAt!,
      verifiedLive: wrapper.source.mode === 'live',
      bodyIncluded: true,
    });
  } catch {
    fail('durability_unverified');
  }
}
