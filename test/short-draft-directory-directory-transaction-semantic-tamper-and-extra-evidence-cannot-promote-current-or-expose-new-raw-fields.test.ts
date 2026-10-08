import test from 'node:test';

import { durable } from './helpers/short-draft-directory-durable.js';

import assert from 'node:assert/strict';

import { canonicalJson, type Job } from '../src/runtime/store.js';

import { clone, RAW } from './helpers/short-draft-directory-deferred.js';

import { createHash } from 'node:crypto';

import { writeFileSync } from 'node:fs';

import path from 'node:path';

import { DatabaseSync } from 'node:sqlite';

import {
  validateShortDraftDirectoryContext,
  projectShortDraftDirectoryContext,
  safeShortDraftDirectoryJob,
} from '../src/platform/short-draft-directory.js';

test('directory transaction semantic tamper and extra evidence cannot promote current or expose new raw fields', async () => {
  const d = await durable(1);
  try {
    const first = await d.execute().completion;
    assert.equal(first.status, 'succeeded');
    const prior = canonicalJson(
      d.store.getCurrent('directory-test', 'native_short_draft_directory.v1'),
    );
    for (const kind of ['field', 'source', 'issued_source', 'count', 'time', 'extra'] as const) {
      const bad = await d.execute((ref) => {
        if (kind === 'extra') {
          d.store.saveEvidence(ref.jobId, 'short_drafts', d.store.readEvidence(ref).payload);
          return;
        }
        const document = d.store.readEvidence(ref),
          payload = clone(document.payload) as Record<string, unknown>;
        if (kind === 'field') payload.body = RAW;
        if (kind === 'source') (payload.source as Record<string, unknown>).mode = 'live';
        if (kind === 'issued_source') {
          payload.source = {
            mode: 'live',
            transport: 'default-request',
            application: 'default',
            origin: 'https://fanqienovel.com',
            path: '/api/author/short_article/draft_list/v0/',
          };
          d.store.addJobMetadata(ref.jobId, { shortDraftDirectorySource: 'live' });
        }
        if (kind === 'count') (payload.coverage as Record<string, unknown>).rowsRead = 2;
        if (kind === 'time')
          (payload.cleanup as Record<string, unknown>).checkedAt = '2099-01-01T00:00:00.000Z';
        const changed = {
            ...document,
            ...(kind === 'issued_source' ? { collectionMode: 'live' as const } : {}),
            payload,
          },
          bytes = Buffer.from(`${canonicalJson(changed)}\n`),
          sha256 = createHash('sha256').update(bytes).digest('hex');
        writeFileSync(path.join(d.evidenceDirectory, ref.path), bytes);
        const sql = new DatabaseSync(d.databasePath);
        try {
          sql.prepare('UPDATE evidence SET sha256=? WHERE id=?').run(sha256, ref.id);
        } finally {
          sql.close();
        }
        ref.sha256 = sha256;
        if (kind === 'issued_source')
          assert.equal(
            validateShortDraftDirectoryContext(
              {
                accountId: 'directory-test',
                job: d.store.getJob(ref.jobId)!,
                manifest: null,
                refs: d.store.listEvidence(ref.jobId),
                documents: [d.store.readEvidence(ref)],
                evaluationAt: new Date().toISOString(),
              },
              'prefix',
            ).validated,
            true,
          );
      }).completion;
      assert.notEqual(bad.status, 'succeeded');
      assert.equal(d.store.getManifestForJob('directory-test', bad.id), null);
      assert.equal(
        canonicalJson(d.store.getCurrent('directory-test', 'native_short_draft_directory.v1')),
        prior,
      );
      if (kind !== 'extra' && kind !== 'issued_source')
        assert.throws(() => projectShortDraftDirectoryContext(d.publicContext(bad)));
    }
    assert.equal(d.store.history('directory-test', 'native_short_draft_directory.v1').length, 1);
    assert.equal(d.store.getCurrent('directory-test', 'account'), null);
  } finally {
    await d.close();
  }
});

test('directory legitimate negative own observation persists partial safe evidence and leaves current untouched', async () => {
  const d = await durable();
  try {
    const first = await d.execute().completion;
    assert.equal(first.status, 'succeeded');
    const prior = canonicalJson(
      d.store.getCurrent('directory-test', 'native_short_draft_directory.v1'),
    );
    d.f.control.ownerAfter = '1002';
    const job = await d.execute().completion;
    assert.equal(job.status, 'partial');
    const view = projectShortDraftDirectoryContext(d.publicContext(job));
    assert.equal(view.data[0]!.status, 'capability_unavailable');
    assert.equal(view.data[0]!.reason, 'owner_changed');
    assert.deepEqual(view.data[0]!.records, []);
    assert.equal(view.data[0]!.coverage.complete, false);
    assert.equal(view.manifest, null);
    assert.equal(
      canonicalJson(d.store.getCurrent('directory-test', 'native_short_draft_directory.v1')),
      prior,
    );
    assert.equal(d.store.listEvidence(job.id).length, 1);
    assert.equal(JSON.stringify(view).includes(RAW), false);
    assert.equal(Object.hasOwn(view.data[0]!, 'owner'), false);
  } finally {
    await d.close();
  }
});

test('directory complete public context rejects foreign account frame hashes metadata key and manifest time tampering', async () => {
  const d = await durable(0);
  try {
    const job = await d.execute().completion,
      actual = d.publicContext(job);
    for (const alter of [
      (c: typeof actual) => {
        c.accountId = 'foreign';
      },
      (c: typeof actual) => {
        c.job.idempotencyKey = 'caller-controlled';
      },
      (c: typeof actual) => {
        c.job.inputHash = 'f'.repeat(64);
      },
      (c: typeof actual) => {
        c.job.metadata.shortDraftDirectoryOwnerId = '1002';
      },
      (c: typeof actual) => {
        c.refs[0]!.sha256 = 'f'.repeat(64);
      },
      (c: typeof actual) => {
        c.documents[0]!.accountId = 'foreign';
      },
      (c: typeof actual) => {
        c.manifest!.committedAt = '2099-01-01T00:00:00.000Z';
      },
      (c: typeof actual) => {
        c.job.endedAt = '2099-01-01T00:00:00.000Z';
      },
      (c: typeof actual) => {
        c.refs.push(clone(c.refs[0]!));
      },
    ]) {
      const bad = clone(actual);
      alter(bad);
      assert.throws(() => projectShortDraftDirectoryContext(bad));
    }
    let reads = 0;
    const malicious = Object.defineProperty({}, 'id', {
      enumerable: true,
      get() {
        reads++;
        throw Error(RAW);
      },
    });
    const safe = safeShortDraftDirectoryJob(malicious as Job, null);
    assert.equal(safe.id, null);
    assert.equal(safe.status, null);
    assert.equal(reads, 0);
    assert.equal(JSON.stringify(safe).includes(RAW), false);
  } finally {
    await d.close();
  }
});
