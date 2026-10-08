import test from 'node:test';

import {
  physicalReadFixture,
  sealBodyReadContext,
} from './helpers/short-native-body-proof-independent-reconciliation.js';

import { projectNativeShortBodyReadContext } from '../src/platform/short-native-body-runtime.js';

import assert from 'node:assert/strict';

import {
  SCOPE,
  REPRESENTATION,
  BASES,
  sha,
  BINDING,
  MARKER,
  bytesHash,
  data,
  DRAFT_STATUS_FACTS,
  WORK,
  clone,
} from './helpers/short-native-body-proof-utf16.js';

import { readFileSync, writeFileSync } from 'node:fs';

import path from 'node:path';

import { type NativeShortEvidenceContext } from '../src/platform/short-native-metadata-proof.js';

import { createNativeShortMetadataSnapshot } from '../src/platform/short-native-metadata.js';

import { DatabaseSync } from 'node:sqlite';

test('body explicit read projection actual SQL physical context emits only paragraph provenance and fixed hashes', () => {
  const f = physicalReadFixture();
  try {
    const context = f.context(),
      projection = projectNativeShortBodyReadContext(context);
    assert.equal(projection.schema, 'fanqie-short-native-body-snapshot/v1');
    assert.equal(projection.status, 'success');
    assert.equal(projection.snapshotScope, SCOPE);
    assert.equal(projection.representation, REPRESENTATION);
    assert.equal(projection.hashBasis, BASES.snapshot);
    assert.deepEqual(projection.hashBases, BASES);
    assert.equal(projection.expectedState, 'draft');
    assert.equal(projection.versionScope, 'author-edit-current');
    assert.equal(projection.publishedVersionVerified, false);
    assert.equal(projection.verifiedLive, false);
    assert.equal(projection.bodyIncluded, true);
    assert.deepEqual(projection.paragraphs, [
      { sourceIndex: 0, lines: ['PRIVATE_LINE&甲', '乙'] },
      { sourceIndex: 1, lines: [''] },
    ]);
    assert.deepEqual(projection.marker, {
      boundary: null,
      markerCount: 0,
      paragraphCount: 2,
      eligibleParagraphCount: 1,
      characterCount: 15,
      prefixCharacterCount: 0,
      displayPercent: null,
    });
    assert.equal(
      projection.bodyHash,
      sha({ basis: BASES.body, binding: BINDING, body: 'PRIVATE_LINE&甲\n乙\n' }),
    );
    assert.equal(
      projection.paragraphsHash,
      sha({
        basis: BASES.paragraphs,
        binding: BINDING,
        paragraphs: ['<p>PRIVATE_LINE&amp;甲<br>乙</p>', '<p></p>'],
      }),
    );
    assert.equal(
      projection.markerHash,
      sha({ basis: BASES.marker, binding: BINDING, marker: MARKER }),
    );
    assert.equal(
      projection.sourceVectorHash,
      sha({
        basis: BASES.sourceVector,
        binding: BINDING,
        paragraphs: [
          {
            sourceIndex: 0,
            lines: ['PRIVATE_LINE&甲', '乙'],
            rawHtml: '<p>PRIVATE_LINE&amp;甲<br>乙</p>',
          },
          { sourceIndex: 1, lines: [''], rawHtml: '<p></p>' },
        ],
      }),
    );
    assert.equal(projection.sourceRef, f.ref.id);
    assert.equal(
      projection.evidenceHash,
      bytesHash(readFileSync(path.join(f.store.evidenceDirectory, f.ref.path), 'utf8')),
    );
    assert.equal(projection.capturedAt, f.ref.capturedAt);
    assert.equal(
      projection.readStartedAt,
      (data(data(context.document.payload).result).proof as { readStartedAt: string })
        .readStartedAt,
    );
    assert.equal(projection.readFinishedAt, projection.readStartedAt);
    assert.equal(projection.proofCapturedAt, projection.readStartedAt);
    assert.deepEqual(
      Object.keys(projection).sort(),
      [
        'schema',
        'status',
        'state',
        'statusFacts',
        'statusSource',
        'snapshotScope',
        'representation',
        'hashBasis',
        'hashBases',
        'expectedState',
        'versionScope',
        'publishedVersionVerified',
        'snapshotVersionHash',
        'catalogHash',
        'documentHash',
        'savedFieldsHash',
        'categorySelectionHash',
        'sourceVectorHash',
        'observedWireVectorHash',
        'bodyHash',
        'paragraphsHash',
        'markerHash',
        'coversHash',
        'paragraphs',
        'marker',
        'sourceRef',
        'evidenceHash',
        'capturedAt',
        'readStartedAt',
        'readFinishedAt',
        'proofCapturedAt',
        'verifiedLive',
        'bodyIncluded',
      ].sort(),
    );
    assert.equal(projection.state, 'draft');
    assert.deepEqual(projection.statusFacts, DRAFT_STATUS_FACTS);
    assert.deepEqual(projection.statusSource, {
      phase: 'read',
      sourceRef: f.ref.id,
      evidenceHash: f.ref.sha256,
      evidenceCapturedAt: f.ref.capturedAt,
    });
    assert.deepEqual(Object.keys(projection.paragraphs[0]!).sort(), ['lines', 'sourceIndex']);
    const serialized = JSON.stringify(projection);
    for (const privateValue of [
      'PRIVATE_TITLE',
      'PRIVATE_TAIL',
      'PRIVATE_HEAD_URI',
      'PRIVATE_COVER_URI',
      'PRIVATE_OPAQUE_COOKIE',
      'PRIVATE_OPAQUE_HEADER',
      JSON.stringify(BINDING.account.id),
      JSON.stringify(WORK),
      'body-read-runtime-owner',
      'rawHtml',
      'editData',
      'categoryData',
      'cookies',
      'authorization',
      'operations.sqlite',
      'http',
    ])
      assert.equal(serialized.includes(privateValue), false, privateValue);
    assert.equal(Object.isFrozen(projection), true);
    assert.equal(Object.isFrozen(projection.paragraphs[0]!.lines), true);
  } finally {
    f.close();
  }
});

test('body explicit read projection foreign partial stale mixed and physical mismatch deny all body', () => {
  const f = physicalReadFixture();
  try {
    const source = f.context();
    for (const mutate of [
      (c: NativeShortEvidenceContext) => {
        c.accountId = 'foreign-runtime-owner';
      },
      (c: NativeShortEvidenceContext) => {
        c.job!.status = 'partial';
      },
      (c: NativeShortEvidenceContext) => {
        c.job!.operation = 'read-anything';
      },
      (c: NativeShortEvidenceContext) => {
        c.manifest!.evidence = [];
      },
      (c: NativeShortEvidenceContext) => {
        c.ref.sha256 = '0'.repeat(64);
      },
      (c: NativeShortEvidenceContext) => {
        c.job!.metadata = { schema: 'native-short-body-closure/v1' };
      },
      (c: NativeShortEvidenceContext) => {
        data(data(c.document.payload).result).snapshot = null;
      },
      (c: NativeShortEvidenceContext) => {
        data(data(data(c.document.payload).result).proof).ownerAfter = false;
      },
      (c: NativeShortEvidenceContext) => {
        data(data(data(c.document.payload).result).cleanup).pendingAtEnd = 1;
      },
      (c: NativeShortEvidenceContext) => {
        data(data(data(c.document.payload).result).proof).proofCapturedAt =
          '2999-01-01T00:00:00.000Z';
      },
    ]) {
      const bad = clone(source);
      mutate(bad);
      assert.throws(() => projectNativeShortBodyReadContext(bad), {
        code: 'capability_unavailable',
        message: 'Native short body is unavailable.',
      });
    }
    // A fully resealed foreign snapshot still fails its physical/runtime target graph.
    const foreign = clone(source),
      wrapper = data(foreign.document.payload),
      result = data(wrapper.result);
    const rebound = createNativeShortMetadataSnapshot({
      binding: {
        account: { kind: 'account_id', id: '9002' },
        work: { kind: 'short', id: '7000000002' },
      },
      editData: { ...f.source.editData, item_id: '7000000002' },
      categoryData: f.source.categoryData,
    });
    result.snapshot = rebound;
    sealBodyReadContext(foreign);
    assert.throws(() => projectNativeShortBodyReadContext(foreign));
    const liveLie = clone(source);
    data(liveLie.document.payload).source = { origin: 'https://fanqienovel.com', mode: 'live' };
    data(liveLie.document.payload).provenance = {
      executor: 'application-default-browser/v1',
      mode: 'live',
    };
    sealBodyReadContext(liveLie);
    assert.throws(() => projectNativeShortBodyReadContext(liveLie));
    const actualPath = path.join(f.store.evidenceDirectory, f.ref.path),
      held = readFileSync(actualPath);
    writeFileSync(actualPath, '{}\n');
    assert.throws(f.context);
    writeFileSync(actualPath, held);
    const sql = new DatabaseSync(f.store.databasePath);
    try {
      sql.prepare('UPDATE jobs SET status=? WHERE id=?').run('partial', f.job.id);
    } finally {
      sql.close();
    }
    assert.throws(() => projectNativeShortBodyReadContext(f.context()));
  } finally {
    f.close();
  }
});

test('body explicit read projection captures descriptors without invoking getter and rejects nondraft parser failures', () => {
  const f = physicalReadFixture();
  let getters = 0;
  try {
    for (const key of ['document', 'accountId', 'job', 'manifest', 'ref']) {
      const bad = clone(f.context());
      Object.defineProperty(bad, key, {
        enumerable: true,
        get() {
          getters++;
          return null;
        },
      });
      assert.throws(() => projectNativeShortBodyReadContext(bad));
    }
    const bad = clone(f.context());
    Object.defineProperty(bad.document, 'payload', {
      enumerable: true,
      get() {
        getters++;
        return null;
      },
    });
    assert.throws(() => projectNativeShortBodyReadContext(bad));
    assert.equal(getters, 0);
  } finally {
    f.close();
  }
  for (const source of [
    { content: '<p>PRIVATE_PUBLISHED</p><p></p>', state: 1 },
    { content: '<div>PRIVATE_UNSUPPORTED</div>', state: 0 },
  ]) {
    const fixture = physicalReadFixture(source.content, source.state);
    try {
      assert.throws(() => projectNativeShortBodyReadContext(fixture.context()), {
        code: 'capability_unavailable',
      });
    } finally {
      fixture.close();
    }
  }
});
