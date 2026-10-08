import test from 'node:test';

import {
  fixture,
  WORK,
  noPrivate,
  SCOPE,
} from './helpers/short-native-metadata-integration-snapshot.js';

import {
  writeBusiness,
  nativeSaveFixture,
} from './helpers/short-native-metadata-integration-native-write-snapshot.js';

import assert from 'node:assert/strict';

import {
  projectNativeShortWriteEvidence,
  NATIVE_SHORT_READ_OPERATION,
} from '../src/platform/short-native-metadata-proof.js';

import { createApplication } from '../src/application.js';

import { BrowserSession } from '../src/platform/browser.js';

import { DatabaseSync } from 'node:sqlite';

import path from 'node:path';

test('C3 public native update validates exact presence and respects default writes-disabled before queue', async (t) => {
  const f = fixture();
  try {
    const call = (args: unknown) =>
      f.app.dispatch(
        'POST',
        '/api/v1/tools/fanqie_update_work_metadata',
        new URLSearchParams(),
        args,
      );
    const valid = { idempotencyKey: 'native-public-stays-off', ...writeBusiness() };
    for (const patch of [
      { title: 'Changed title' },
      { title: 'Changed title', metadata: {} },
      { metadata: { categories: ['10'] } },
      { title: 'Changed title', metadata: { categories: ['10'] } },
    ]) {
      await assert.rejects(
        call({ idempotencyKey: 'native-public-stays-off', ...writeBusiness(patch) }),
        (error: any) => error.code === 'writes_disabled',
      );
    }
    const mutations: [string, (args: any) => void][] = [
      [
        'one-version-signal',
        (a) => {
          delete a.snapshotScope;
          delete a.hashBasis;
        },
      ],
      ['wrong-basis', (a) => (a.hashBasis = 'plainHTMLstrip')],
      ['wrong-scope', (a) => (a.snapshotScope = 'legacy')],
      ['mixed-version', (a) => (a.expectedContentHash = 'a'.repeat(64))],
      ['undefined-version', (a) => (a.snapshotScope = undefined)],
      ['blank-title', (a) => (a.title = '  ')],
      ['newline-title', (a) => (a.title = 'one\ntwo')],
      ['oversized-title', (a) => (a.title = '字'.repeat(342))],
      ['empty-patch', (a) => delete a.title],
      [
        'empty-categories',
        (a) => {
          delete a.title;
          a.metadata = { categories: [] };
        },
      ],
      ['duplicate-categories', (a) => (a.metadata = { categories: ['10', '10'] })],
      ['comma-category', (a) => (a.metadata = { categories: ['10,r1'] })],
      ['unsupported-metadata', (a) => (a.metadata = { cover: 'PRIVATE_URI_ONE' })],
      ['chapter-target', (a) => (a.target.kind = 'chapter')],
      ['extra-chapter-id', (a) => (a.target.chapterId = WORK)],
      ['leading-zero-work', (a) => (a.target.workId = '0700000001')],
      ['non-draft', (a) => (a.expectedState = 'published')],
      ['unknown-top-field', (a) => (a.expectedRevision = 1)],
    ];
    for (const [name, mutate] of mutations)
      await t.test(name, async () => {
        const args = structuredClone(valid);
        mutate(args);
        await assert.rejects(call(args));
      });
    for (const input of [
      {
        idempotencyKey: 'legacy-missing-fields',
        target: { kind: 'short', workId: WORK },
        expectedState: 'draft',
        metadata: {},
      },
      {
        idempotencyKey: 'legacy-missing-fields',
        target: { kind: 'short', workId: WORK },
        expectedState: 'draft',
        expectedContentHash: 'a'.repeat(64),
      },
    ])
      await assert.rejects(call(input), (error: any) => error.code === 'invalid_input');
    await assert.rejects(
      call({
        idempotencyKey: 'legacy-remains-disabled',
        target: { kind: 'short', workId: WORK },
        expectedState: 'draft',
        expectedContentHash: 'a'.repeat(64),
        metadata: {},
      }),
      (error: any) => error.code === 'writes_disabled',
    );
    assert.equal(f.calls, 0);
    assert.deepEqual(
      ((await f.app.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined)) as any).jobs,
      [],
    );
    assert.equal(f.app.tools.length, 40);
    const cap = (await f.app.dispatch(
      'GET',
      '/api/v1/capabilities',
      new URLSearchParams(),
      undefined,
    )) as any;
    assert.equal(cap.writes.nativeShortMetadata.available, false);
  } finally {
    await f.close();
  }
});

test('C3 real durable failure stages keep partial status or uncertain without success/raw/current', async (t) => {
  for (const [fault, refs, posts, status] of [
    ['intent', 1, 0, 'failed'],
    ['post', 2, 1, 'uncertain'],
    ['mismatch', 2, 1, 'uncertain'],
    ['cleanup', 2, 1, 'uncertain'],
    ['after', 2, 1, 'uncertain'],
    ['result', 3, 1, 'uncertain'],
  ] as const)
    await t.test(fault, async () => {
      const f = await nativeSaveFixture(fault);
      try {
        assert.equal(f.job.status, status);
        assert.equal(f.refs.length, refs);
        assert.equal(f.postCount, posts);
        const view = projectNativeShortWriteEvidence(f.context);
        assert.equal(view.result, null);
        noPrivate(view);
        if (status === 'failed') assert.deepEqual(view.data, []);
        else assert.equal(view.data[0]!.status, 'uncertain');
        const app = createApplication(f.config, {
          browser: new BrowserSession({ profileDir: f.config.profileDir, headless: true }),
        });
        try {
          const output = (await app.dispatch(
            'POST',
            '/api/v1/tools/fanqie_get_job',
            new URLSearchParams(),
            { jobId: f.job.id },
          )) as any;
          assert.equal(output.job.status, status);
          assert.equal(output.sourceMode, 'incomplete');
          assert.equal(output.job.result, null);
          noPrivate(output);
          noPrivate(await app.dispatch('GET', '/api/v1/jobs', new URLSearchParams(), undefined));
          assert.equal(
            (
              (await app.dispatch(
                'GET',
                '/api/v1/snapshot',
                new URLSearchParams({ scope: SCOPE }),
                undefined,
              )) as any
            ).manifest,
            null,
          );
        } finally {
          await app.close();
        }
      } finally {
        await f.close();
      }
    });
});

test('C3 complete write context rejects extra/conflicting signals, links, counts and future closure as a whole', async (t) => {
  const f = await nativeSaveFixture();
  try {
    assert.equal(projectNativeShortWriteEvidence(f.context).validated, true);
    const mutations: [string, (ctx: any) => void][] = [
      [
        'job-metadata-future',
        (c) => (c.job.metadata = { schema: 'native-short-metadata-reconciliation/v2' }),
      ],
      [
        'job-error-future',
        (c) =>
          (c.job.error = {
            code: 'unknown',
            message: 'PRIVATE_HTML',
            details: { schema: 'native-short-metadata-future/v1' },
          }),
      ],
      [
        'job-result-future',
        (c) => (c.job.result.future = { schema: 'native-short-metadata-future/v1' }),
      ],
      [
        'manifest-for-write',
        (c) =>
          (c.manifest = {
            operation: NATIVE_SHORT_READ_OPERATION,
            schema: 'native-short-metadata-future/v1',
          }),
      ],
      [
        'extra-ref',
        (c) => {
          c.refs.push(c.refs[0]);
          c.documents.push(c.documents[0]);
        },
      ],
      ['ref-native-future', (c) => (c.refs[0].dataset = 'short_native_metadata_future')],
      ['document-future', (c) => (c.documents[0].dataset = 'short_native_metadata_future')],
      [
        'payload-future',
        (c) => (c.documents[0].payload.future = { schema: 'native-short-metadata-future/v1' }),
      ],
      ['intent-link', (c) => (c.documents[1].payload.baselineEvidence.sha256 = 'a'.repeat(64))],
      ['after-link', (c) => (c.documents[2].payload.intentEvidence.id = c.refs[0].id)],
      ['wrong-post-count', (c) => (c.documents[2].payload.result.post.attempts = 2)],
      [
        'wrong-after-dispose',
        (c) => (c.documents[2].payload.result.phases.after.requests.edit.disposed = 0),
      ],
      ['held-pretends-closed', (c) => (c.documents[0].payload.held.cleanup.sessionDisposed = true)],
      ['pending-after', (c) => (c.documents[2].payload.result.cleanup.pendingAtEnd = 1)],
      [
        'wrong-selection',
        (c) => (c.documents[2].payload.result.snapshot.categorySelectionHash = '0'.repeat(64)),
      ],
      [
        'wrong-intent-version',
        (c) => (c.documents[1].payload.expectedSnapshotVersionHash = '0'.repeat(64)),
      ],
      ['wrong-input', (c) => (c.job.inputHash = '0'.repeat(64))],
      ['wrong-target', (c) => (c.job.target.id = '8000000001')],
      ['wrong-service-account', (c) => (c.accountId = 'other')],
      ['wrong-mark-time', (c) => (c.job.platformWriteStartedAt = '2000-01-01T00:00:00.000Z')],
      [
        'missing-result-ref',
        (c) => {
          c.refs.pop();
          c.documents.pop();
        },
      ],
      [
        'future-closure-schema',
        (c) =>
          (c.job.result = { schema: 'native-short-metadata-closure/v2', result: f.job.result }),
      ],
    ];
    for (const [name, mutate] of mutations)
      await t.test(name, () => {
        const ctx = structuredClone(f.context);
        mutate(ctx);
        assert.throws(() => projectNativeShortWriteEvidence(ctx));
      });
    let getterCalls = 0;
    const ctx = structuredClone(f.context);
    Object.defineProperty(ctx.documents[0]!.payload as object, 'held', {
      enumerable: true,
      get() {
        getterCalls++;
        return null;
      },
    });
    assert.throws(() => projectNativeShortWriteEvidence(ctx));
    assert.equal(getterCalls, 0);
    // A future runtime signal in a saved otherwise-valid write cannot merely hide metadata and retain validated data.
    const db = new DatabaseSync(path.join(f.config.dataDir, 'operations.sqlite'));
    db.prepare('UPDATE jobs SET metadata_json=? WHERE id=?').run(
      JSON.stringify({ schema: 'native-short-metadata-reconciliation/v2' }),
      f.job.id,
    );
    db.close();
    const app = createApplication(f.config, {
      browser: new BrowserSession({ profileDir: f.config.profileDir, headless: true }),
    });
    try {
      for (const name of ['get_job', 'cancel_job']) {
        const output = (await app.dispatch(
          'POST',
          '/api/v1/tools/fanqie_' + name,
          new URLSearchParams(),
          { jobId: f.job.id },
        )) as any;
        assert.equal(output.job.projectionStatus, 'capability_unavailable');
        assert.equal(output.job.result, null);
        assert.equal(output.data[0].status, 'capability_unavailable');
        noPrivate(output);
      }
      const jobs = (await app.dispatch(
        'GET',
        '/api/v1/jobs',
        new URLSearchParams(),
        undefined,
      )) as any;
      assert.equal(jobs.jobs[0].projectionStatus, 'capability_unavailable');
      noPrivate(jobs);
    } finally {
      await app.close();
    }
  } finally {
    await f.close();
  }
});
