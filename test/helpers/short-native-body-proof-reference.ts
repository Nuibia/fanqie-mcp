import {
  type Data,
  raw,
  BASES,
  REPRESENTATION,
  WORK,
  SCOPE,
  sha,
  ACCOUNT,
  BINDING,
  preservation,
  documentHashes,
  MARKER,
  type Trace,
  modernTuple4,
  at,
  TIMES,
  type Stage,
  data,
} from './short-native-body-proof-utf16.js';

import { createNativeShortMetadataSnapshot } from '../../src/platform/short-native-metadata.js';

import assert from 'node:assert/strict';

import { NativeShortBodyProofError } from '../../src/platform/short-native-body-proof.js';

export function reference(extra: Data = {}, afterLatest = 8, noChange = false) {
  const before = raw(undefined, 7, extra),
    desired = raw('<p>乙</p><p></p>', 7, extra),
    after = raw('<p>乙</p><p></p>', afterLatest, extra);
  const nativeBefore = createNativeShortMetadataSnapshot(before),
    nativeDesired = createNativeShortMetadataSnapshot(desired),
    nativeAfter = createNativeShortMetadataSnapshot(after);
  const paragraphs = noChange
    ? [
        { sourceIndex: 0, lines: ['甲'] },
        { sourceIndex: 1, lines: [''] },
      ]
    : [{ sourceIndex: null, lines: ['乙'] }];
  const request = {
    expectedSnapshotVersionHash: nativeBefore.snapshotVersionHash,
    hashBasis: BASES.snapshot,
    expectedState: 'draft',
    representation: REPRESENTATION,
    paragraphs,
    trial: { action: 'preserve' },
  };
  const business = { target: { kind: 'short', workId: WORK }, snapshotScope: SCOPE, ...request };
  const inputHash = sha({
    basis: BASES.business,
    accountId: ACCOUNT,
    target: business.target,
    input: business,
  });
  const wire = [
    { lines: ['乙'], rawHtml: '<p>乙</p>' },
    { lines: [''], rawHtml: '<p></p>' },
  ];
  const coversHash = sha({
    basis: BASES.covers,
    binding: BINDING,
    covers: { thumb_uri: 'synthetic-head-uri', book_thumb_uri: 'synthetic-cover-uri' },
  });
  const expectation = {
    scope: SCOPE,
    representation: REPRESENTATION,
    hashBases: BASES,
    binding: BINDING,
    expectedState: 'draft',
    writeRequest: request,
    sourceVersionHash: nativeBefore.snapshotVersionHash,
    sourceDocumentHash: nativeBefore.documentHash,
    sourceVectorHash: sha({
      basis: BASES.sourceVector,
      binding: BINDING,
      paragraphs: [
        { sourceIndex: 0, lines: ['甲'], rawHtml: '<p>甲</p>' },
        { sourceIndex: 1, lines: [''], rawHtml: '<p></p>' },
      ],
    }),
    expectedDocumentHash: nativeDesired.documentHash,
    expectedSavedFieldsHash: nativeDesired.savedFieldsHash,
    catalogHash: nativeBefore.catalogHash,
    categorySelectionHash: nativeBefore.categorySelectionHash,
    preservationHash: preservation(before),
    coversHash,
    ...documentHashes('乙'),
    submittedVectorHash: sha({ basis: BASES.submittedVector, binding: BINDING, paragraphs }),
    effectiveWireVectorHash: sha({
      basis: BASES.effectiveWireVector,
      binding: BINDING,
      paragraphs: wire,
    }),
    effectiveWireParagraphs: wire,
    appendedWireTerminal: true,
    serverRevisionPolicy: 'safe-increment-one-and-ascii-decimal-10-nondecreasing/v2',
    serverRevisionBefore: { latestVersion: 7, modifyTime: '1789450000' },
    desiredHtml: '<p>乙</p><p></p>',
    marker: MARKER,
  };
  const form = {
    item_id: WORK,
    content: '<p>乙</p><p></p>',
    thumb_uri: 'synthetic-head-uri',
    book_thumb_uri: 'synthetic-cover-uri',
    item_version: '-1',
    multi_title: '["Synthetic title","Synthetic tail"]',
    sign_type: '1',
    activity_flag: '0',
  };
  const desiredHash = sha({ basis: BASES.desired, expectation, form });
  const comparison = {
    matches: afterLatest === 8,
    reason: afterLatest === 8 ? 'match' : 'server_revision_not_proven',
    scope: SCOPE,
    hashBases: BASES,
    actual: {
      snapshotVersionHash: nativeAfter.snapshotVersionHash,
      catalogHash: nativeAfter.catalogHash,
      documentHash: nativeAfter.documentHash,
      savedFieldsHash: nativeAfter.savedFieldsHash,
      categorySelectionHash: nativeAfter.categorySelectionHash,
      preservationHash: preservation(after, afterLatest === 8),
      coversHash,
      ...documentHashes('乙'),
      observedWireVectorHash: sha({
        basis: BASES.effectiveWireVector,
        binding: BINDING,
        paragraphs: wire,
      }),
      serverRevisionPolicy: expectation.serverRevisionPolicy,
      serverRevisionBefore: expectation.serverRevisionBefore,
      serverRevisionAfter: { latestVersion: afterLatest, modifyTime: '1789450000' },
    },
  };
  const trace: Trace = {
    schema: 'native-short-body-fixture-trace/v1',
    scope: SCOPE,
    provenance: { mode: 'fixture', executor: 'dependency-injected-body-owned-run/v1' },
    accountId: ACCOUNT,
    workId: WORK,
    inputHash,
    stages: [],
    simulatedAttemptOrdinal: noChange ? null : 1,
  };
  const payloads: { kind: string; payload: Data }[] = [
    {
      kind: 'baseline',
      payload: { native: modernTuple4(before), businessInput: business, inputHash },
    },
    {
      kind: 'preSave',
      payload: {
        native: modernTuple4(before),
        sourceVersionHash: nativeBefore.snapshotVersionHash,
        desiredContentHash: desiredHash,
      },
    },
    {
      kind: 'intent',
      payload: {
        sourceVersionHash: nativeBefore.snapshotVersionHash,
        desiredContentHash: desiredHash,
        hashBasesHash: sha({ schema: 'native-short-body-fixed-hash-bases/v1', hashBases: BASES }),
      },
    },
    { kind: 'attempt', payload: { simulatedOrdinal: 1, eventAt: at(TIMES, 3) } },
    {
      kind: 'acknowledgement',
      payload: {
        observation: {
          schema: 'native-short-body-fixture-acknowledgement/v1',
          binding: BINDING,
          scope: SCOPE,
          sourceVersionHash: nativeBefore.snapshotVersionHash,
          desiredContentHash: desiredHash,
          acknowledgedAt: at(TIMES, 4),
        },
      },
    },
    { kind: 'after', payload: { native: modernTuple4(after), comparison } },
    {
      kind: 'result',
      payload: {
        outcome: afterLatest === 8 ? 'fixture_matched' : 'fixture_unknown',
        reason: afterLatest === 8 ? 'fixture_not_live' : 'readback_mismatch',
        cleanup: cleaned(at(TIMES, 6)),
      },
    },
  ];
  if (noChange) {
    const first = at(payloads, 0);
    trace.stages = linked([
      first,
      {
        kind: 'result',
        payload: { outcome: 'not_attempted', reason: 'no_change', cleanup: cleaned(at(TIMES, 1)) },
      },
    ]);
  } else trace.stages = linked(payloads);
  return { trace, before, business, desiredHash, comparison, expectation };
}

export function cleaned(checkedAt: string): Data {
  return {
    sessionCreated: true,
    sessionDisposed: true,
    disposalFailures: 0,
    pendingAtEnd: 0,
    quarantined: false,
    checkedAt,
  };
}

function linked(items: readonly { kind: string; payload: Data }[]): Stage[] {
  const stages: Stage[] = [];
  for (const item of items) {
    const index = stages.length,
      stamp =
        item.kind === 'attempt'
          ? item.payload.eventAt
          : item.kind === 'acknowledgement'
            ? data(item.payload.observation).acknowledgedAt
            : item.kind === 'result'
              ? data(item.payload.cleanup).checkedAt
              : at(TIMES, index);
    assert.ok(typeof stamp === 'string');
    stages.push({
      schema: 'native-short-body-fixture-stage/v1',
      kind: item.kind,
      sequence: index + 1,
      eventAt: stamp,
      priorStageHash: index ? sha(at(stages, index - 1)) : null,
      payload: item.payload,
    });
  }
  return stages;
}

export function relink(trace: Trace): Trace {
  trace.stages = linked(
    trace.stages.map((stage) => ({ kind: stage.kind, payload: stage.payload })),
  );
  trace.simulatedAttemptOrdinal = trace.stages.some((stage) => stage.kind === 'attempt') ? 1 : null;
  return trace;
}

export function denied(run: () => unknown, code?: string): void {
  assert.throws(
    run,
    (error) =>
      error instanceof NativeShortBodyProofError &&
      (!code || error.code === code) &&
      error.message === `Native short body fixture proof rejected: ${error.code}` &&
      !error.message.includes('synthetic-original'),
  );
}

// B6 independent full graph. Physical envelope bytes and strict preimages are built here,
// never by a new production builder/projector/Store serializer.
export function physical(value: unknown): string {
  function visit(v: unknown): unknown {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(visit);
    const fields = data(v);
    return Object.fromEntries(
      Object.keys(fields)
        .sort()
        .map((k) => [k, visit(fields[k])]),
    );
  }
  return JSON.stringify(visit(value));
}

export const DACCOUNT = 'synthetic-owner',
  DJOB = '11111111-1111-4111-8111-111111111111',
  DOWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

export const DSOURCE = { mode: 'fixture', executor: 'sqlite-owned-body-fixture/v1' };

export const DT = (n: number): string =>
  new Date(Date.parse('2026-10-04T00:00:00.000Z') + n).toISOString();

export const DTRANSPORT = {
  method: 'POST',
  url: 'https://fanqienovel.com/api/author/short_article/cover/v0/?aid=2503&app_name=muye_novel',
  contentType: 'application/x-www-form-urlencoded;charset=UTF-8',
  maxRedirects: 0,
  maxRetries: 0,
  maxAttempts: 1,
};

export const DDATASETS = {
  baseline: 'short_native_body_baseline',
  preSave: 'short_native_body_pre_save',
  intent: 'write-intent',
  attempt: 'short_native_body_attempt',
  acknowledgement: 'short_native_body_acknowledgement',
  after: 'short_native_body_after',
  result: 'write-result',
};

export function dread(start: number, complete = true): Data {
  return {
    proof: {
      platformStarted: true,
      ownerBefore: true,
      ownerAfter: complete,
      fixedSourceVerified: complete,
      targetUnique: complete,
      paginationComplete: complete,
      atomicRevision: false,
      readStartedAt: DT(start),
      readFinishedAt: complete ? DT(start + 1) : null,
      proofCapturedAt: complete ? DT(start + 2) : null,
    },
    requests: {
      own: { attempts: complete ? 2 : 1, disposed: complete ? 2 : 1 },
      list: { attempts: complete ? 1 : 0, disposed: complete ? 1 : 0 },
      edit: { attempts: complete ? 1 : 0, disposed: complete ? 1 : 0 },
      catalog: { attempts: complete ? 1 : 0, disposed: complete ? 1 : 0 },
    },
    list: {
      pagesRead: complete ? 1 : 0,
      rowsRead: complete ? 1 : 0,
      totalCount: complete ? 1 : null,
    },
  };
}

export function dlink(ref: Data): Data {
  return { id: ref.id, sha256: ref.sha256, capturedAt: ref.capturedAt };
}
