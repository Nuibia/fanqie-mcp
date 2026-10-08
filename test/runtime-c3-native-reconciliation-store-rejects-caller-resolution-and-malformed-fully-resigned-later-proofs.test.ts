import test from 'node:test';

import { fixture } from './helpers/runtime-deferred.js';

import {
  nativeStoreOriginal,
  nativeStoreLater,
  nativeStoreResignLater,
  assertNativeStoreRejected,
} from './helpers/runtime-native-store-original.js';

import assert from 'node:assert/strict';

import { type Job, canonicalJson } from '../src/runtime/store.js';

import { nativeStoreDb } from './helpers/runtime-recovery-baseline.js';

import { writeFileSync } from 'node:fs';

import path from 'node:path';

test('C3 native reconciliation Store rejects caller resolution and malformed fully resigned later proofs', async (t) => {
  const mutations: [string, (document: any) => void][] = [
    [
      'original endedAt',
      (d) => {
        d.payload.originalAudit.originalEndedAt = '2000-01-01T00:00:00.000Z';
      },
    ],
    [
      'prior endedAt',
      (d) => {
        d.payload.originalAudit.priorEndedAt = '2000-01-01T00:00:00.000Z';
      },
    ],
    [
      'prior error',
      (d) => {
        d.payload.originalAudit.priorError = null;
      },
    ],
    [
      'original refs',
      (d) => {
        d.payload.originalAudit.priorEvidence[0].sha256 = '0'.repeat(64);
      },
    ],
    [
      'original result',
      (d) => {
        d.payload.originalAudit.originalResult = { evidence: [] };
      },
    ],
    [
      'nested prior result',
      (d) => {
        d.payload.originalAudit.priorResult = d.payload.originalAudit.originalResult;
      },
    ],
    [
      'audit size',
      (d) => {
        d.payload.originalAudit.priorError.message = 'x'.repeat(65537);
      },
    ],
    [
      'fake observed hash',
      (d) => {
        d.payload.reconciliation.observedContentHash = '0'.repeat(64);
      },
    ],
    [
      'fake comparison',
      (d) => {
        d.payload.comparison.matches = false;
      },
    ],
    [
      'wrong basis',
      (d) => {
        d.payload.hashBases.document = 'stripped-text';
      },
    ],
    [
      'late proof owner',
      (d) => {
        d.payload.result.proof.ownerAfter = false;
      },
    ],
    [
      'cleanup pending',
      (d) => {
        d.payload.result.cleanup.pendingAtEnd = 1;
      },
    ],
    [
      'wrong GET disposed',
      (d) => {
        d.payload.result.requests.catalog.disposed = 0;
      },
    ],
    [
      'fixture executor',
      (d) => {
        d.payload.provenance.executor = 'dependency-injected-browser/v1';
        d.payload.provenance.mode = 'fixture';
        d.payload.source.mode = 'fixture';
      },
    ],
    [
      'fixture evidence',
      (d) => {
        d.collectionMode = 'fixture';
      },
    ],
    [
      'unknown schema',
      (d) => {
        d.payload.schema = 'native-short-metadata-reconciliation/v2';
      },
    ],
    [
      'extra reserved signal',
      (d) => {
        d.payload.extra = { schema: 'native-short-metadata-closure/v2' };
      },
    ],
  ];
  for (const [name, mutate] of mutations)
    await t.test(name, async () => {
      const f = fixture(30_000, 'live');
      try {
        const original = await nativeStoreOriginal(f),
          later = await nativeStoreLater(f, original);
        nativeStoreResignLater(f, later, mutate);
        assertNativeStoreRejected(f, original, later);
      } finally {
        await f.cleanup();
      }
    });
  for (const status of ['failed', 'uncertain'] as const)
    await t.test('caller ' + status, async () => {
      const f = fixture(30_000, 'live');
      try {
        const original = await nativeStoreOriginal(f),
          later = await nativeStoreLater(f, original);
        assertNativeStoreRejected(f, original, later, { status, result: later.resolution.result });
      } finally {
        await f.cleanup();
      }
    });
  await t.test('caller raw result and descriptor getter', async () => {
    const f = fixture(30_000, 'live');
    try {
      const original = await nativeStoreOriginal(f),
        later = await nativeStoreLater(f, original);
      assertNativeStoreRejected(f, original, later, {
        status: 'succeeded',
        result: { ...later.resolution.result, rawHTML: 'PRIVATE_UNSAFE' },
      });
      let evaluated = 0;
      const request = { result: later.resolution.result } as any;
      Object.defineProperty(request, 'status', {
        enumerable: true,
        get() {
          evaluated++;
          return 'succeeded';
        },
      });
      assertNativeStoreRejected(f, original, later, request);
      assert.equal(evaluated, 0);
    } finally {
      await f.cleanup();
    }
  });
});

test('C3 native reconciliation Store requires all actual original and external read bindings', async (t) => {
  const mutations: [
    string,
    (
      f: ReturnType<typeof fixture>,
      original: Job,
      later: Awaited<ReturnType<typeof nativeStoreLater>>,
    ) => void,
  ][] = [
    [
      'original account',
      (f, original) => {
        nativeStoreDb(f)
          .prepare('UPDATE jobs SET account_id = ? WHERE id = ?')
          .run('other', original.id);
      },
    ],
    [
      'original target',
      (f, original) => {
        nativeStoreDb(f)
          .prepare('UPDATE jobs SET target_json = ? WHERE id = ?')
          .run(canonicalJson({ kind: 'short-story', id: '7000000002' }), original.id);
      },
    ],
    [
      'original input',
      (f, original) => {
        nativeStoreDb(f)
          .prepare('UPDATE jobs SET input_hash = ? WHERE id = ?')
          .run('0'.repeat(64), original.id);
      },
    ],
    [
      'original scope',
      (f, original) => {
        nativeStoreDb(f)
          .prepare('UPDATE jobs SET scope = ? WHERE id = ?')
          .run('short_native_metadata.7000000002', original.id);
      },
    ],
    [
      'missing original mark',
      (f, original) => {
        nativeStoreDb(f)
          .prepare('UPDATE jobs SET write_started_at = NULL WHERE id = ?')
          .run(original.id);
      },
    ],
    [
      'baseline bytes',
      (f, original) => {
        const ref = f.store.listEvidence(original.id)[0]!;
        writeFileSync(path.join(f.options.evidenceDirectory, ref.path), 'tampered');
      },
    ],
    [
      'duplicate original intent',
      (f, original) => {
        const ref = f.store.listEvidence(original.id)[1]!;
        nativeStoreDb(f)
          .prepare(
            'INSERT INTO evidence(id,account_id,job_id,dataset,captured_at,path,sha256) VALUES(?,?,?,?,?,?,?)',
          )
          .run(
            '00000000-0000-0000-0000-000000000001',
            ref.accountId,
            ref.jobId,
            ref.dataset,
            ref.capturedAt,
            'synthetic-duplicate-path',
            ref.sha256,
          );
      },
    ],
    [
      'later operation',
      (f, _original, later) => {
        nativeStoreDb(f)
          .prepare('UPDATE jobs SET operation = ? WHERE id = ?')
          .run('legacy_reconcile', later.read.id);
      },
    ],
    [
      'later datasets',
      (f, _original, later) => {
        nativeStoreDb(f)
          .prepare('UPDATE jobs SET datasets_json = ? WHERE id = ?')
          .run('[]', later.read.id);
      },
    ],
    [
      'later input',
      (f, _original, later) => {
        nativeStoreDb(f)
          .prepare('UPDATE jobs SET input_hash = ? WHERE id = ?')
          .run('0'.repeat(64), later.read.id);
      },
    ],
    [
      'later write mark',
      (f, _original, later) => {
        nativeStoreDb(f)
          .prepare('UPDATE jobs SET write_started_at = ? WHERE id = ?')
          .run(later.read.platformReadStartedAt, later.read.id);
      },
    ],
    [
      'missing external manifest',
      (f, _original, later) => {
        nativeStoreDb(f)
          .prepare('DELETE FROM current_manifests WHERE manifest_id = ?')
          .run(later.manifest.id);
        nativeStoreDb(f).prepare('DELETE FROM manifests WHERE id = ?').run(later.manifest.id);
      },
    ],
    [
      'external manifest hash',
      (f, _original, later) => {
        const manifest = structuredClone(later.manifest);
        manifest.evidence[0]!.sha256 = '0'.repeat(64);
        nativeStoreDb(f)
          .prepare('UPDATE manifests SET manifest_json = ? WHERE id = ?')
          .run(canonicalJson(manifest), manifest.id);
      },
    ],
  ];
  for (const [name, mutate] of mutations)
    await t.test(name, async () => {
      const f = fixture(30_000, 'live');
      try {
        const original = await nativeStoreOriginal(f),
          later = await nativeStoreLater(f, original);
        mutate(f, original, later);
        assertNativeStoreRejected(f, f.store.getJob(original.id)!, later);
      } finally {
        await f.cleanup();
      }
    });
});
