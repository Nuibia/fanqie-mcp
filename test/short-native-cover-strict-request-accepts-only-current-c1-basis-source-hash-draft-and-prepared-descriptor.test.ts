import test from 'node:test';

import {
  snapshot,
  mutable,
  request,
  rejected,
  raw,
  intent,
  changed,
  ack,
  target,
  html,
  after,
} from './helpers/short-native-cover-asset.js';

import {
  createNativeShortCoverUploadIntent,
  type NativeShortCoverUploadRequest,
  assertNativeShortCoverPreSave,
  planNativeShortCoverSave,
  type NativeShortCoverUploadIntent,
  nativeShortCoverDesiredContentHash,
  compareNativeShortCoverReadback,
} from '../src/platform/short-native-cover.js';

import {
  type NativeShortMetadataSnapshot,
  NATIVE_SHORT_HASH_BASES,
  NATIVE_SHORT_METADATA_SCOPE,
  planNativeShortMetadataUpdate,
  nativeShortMetadataEndpoints,
} from '../src/platform/short-native-metadata.js';

import assert from 'node:assert/strict';

test('strict request accepts only current C1 basis, source hash, draft and prepared descriptor', () => {
  const before = snapshot();
  for (const change of [
    (value: Record<string, any>) => {
      value.hashBasis = 'another-basis/v1';
    },
    (value: Record<string, any>) => {
      value.expectedSnapshotVersionHash = '0'.repeat(64);
    },
    (value: Record<string, any>) => {
      value.expectedState = 'published';
    },
    (value: Record<string, any>) => {
      value.title = 'unrequested';
    },
    (value: Record<string, any>) => {
      value.metadata = { categories: ['10'] };
    },
    (value: Record<string, any>) => {
      delete value.asset;
    },
  ]) {
    const value = mutable(request(before));
    change(value);
    rejected(() =>
      createNativeShortCoverUploadIntent(before, value as NativeShortCoverUploadRequest),
    );
  }
  for (const change of [
    (input: ReturnType<typeof raw>) => {
      input.editData.publish_status = 1;
    },
    (input: ReturnType<typeof raw>) => {
      input.editData.publish_status = 99;
    },
    (input: ReturnType<typeof raw>) => {
      input.editData.sign_type = 0;
    },
    (input: ReturnType<typeof raw>) => {
      input.editData.origin_activity_flag = 2;
    },
  ]) {
    const invalid = snapshot(change);
    rejected(() => createNativeShortCoverUploadIntent(invalid, request(invalid)));
  }
});

test('all derived snapshot carriers are checked against a rebuilt full snapshot', () => {
  const before = snapshot(),
    upload = intent(before);
  for (const field of [
    'state',
    'responseBinding',
    'catalog',
    'savedFields',
    'hashBases',
    'scope',
    'snapshotVersionHash',
    'catalogHash',
    'documentHash',
    'savedFieldsHash',
    'categorySelectionHash',
  ]) {
    const value = mutable(before);
    if (field === 'state') value[field] = 'published';
    else if (field === 'responseBinding') value[field] = 'sentinel';
    else if (field === 'catalog') value[field][0].name = 'tampered carrier';
    else if (field === 'savedFields') value[field].content = 'tampered carrier';
    else value[field] = 'tampered carrier';
    rejected(() => assertNativeShortCoverPreSave(value as NativeShortMetadataSnapshot, upload));
  }
  const extra = mutable(before);
  extra.transport = true;
  rejected(
    () => assertNativeShortCoverPreSave(extra as NativeShortMetadataSnapshot, upload),
    'snapshot_shape',
  );
});

test('preSave source-drift table blocks every field, including the fields later masked in readback', () => {
  for (const [_name, mutate] of [
    [
      'first title',
      (edit: Record<string, unknown>) => {
        (edit.multi_title as string[])[0] = 'Other primary';
      },
    ],
    [
      'tail title',
      (edit: Record<string, unknown>) => {
        (edit.multi_title as string[])[2] = 'Other tail';
      },
    ],
    [
      'content',
      (edit: Record<string, unknown>) => {
        edit.content += ' ';
      },
    ],
    [
      'head URI',
      (edit: Record<string, unknown>) => {
        edit.thumb_uri = 'changed';
      },
    ],
    [
      'head URL',
      (edit: Record<string, unknown>) => {
        edit.thumb_url_list = ['changed'];
      },
    ],
    [
      'recommended URI',
      (edit: Record<string, unknown>) => {
        edit.book_thumb_uri = 'changed';
      },
    ],
    [
      'recommended derived URL',
      (edit: Record<string, unknown>) => {
        edit.book_thumb_url_list = ['changed'];
      },
    ],
    [
      'unknown raw',
      (edit: Record<string, unknown>) => {
        edit.description = 'changed';
      },
    ],
    [
      'unknown addition',
      (edit: Record<string, unknown>) => {
        edit.extra_field = null;
      },
    ],
    [
      'unknown deletion',
      (edit: Record<string, unknown>) => {
        delete edit.title_problem;
      },
    ],
    [
      'raw sign type',
      (edit: Record<string, unknown>) => {
        edit.sign_type = 1;
      },
    ],
    [
      'category raw',
      (edit: Record<string, unknown>) => {
        (edit.category as Array<Record<string, unknown>>)[0]!.opaque = [];
      },
    ],
    [
      'revision',
      (edit: Record<string, unknown>) => {
        edit.latest_version = 8;
      },
    ],
    [
      'modify token',
      (edit: Record<string, unknown>) => {
        edit.modify_time = '0000000124';
      },
    ],
  ] as const) {
    const before = snapshot(),
      upload = intent(before),
      drift = changed(before, mutate);
    rejected(() => assertNativeShortCoverPreSave(drift, upload), 'source_version_mismatch');
    rejected(() => planNativeShortCoverSave(drift, upload, ack), 'source_version_mismatch');
  }
});

test('preSave rejects catalog, account and work drift and every changed intent carrier hash', () => {
  const before = snapshot(),
    upload = intent(before);
  const catalog = changed(before, (_edit, categories) => {
    categories.extra = 'new';
  });
  rejected(() => assertNativeShortCoverPreSave(catalog, upload), 'source_version_mismatch');
  for (const rebound of [
    { ...target, account: { kind: 'account_id' as const, id: '1002' } },
    { ...target, work: { kind: 'short' as const, id: '7000000002' } },
  ]) {
    const other = changed(
      before,
      (edit) => {
        edit.item_id = rebound.work.id;
      },
      rebound,
    );
    rejected(() => assertNativeShortCoverPreSave(other, upload), 'binding_changed');
  }
  for (const field of [
    'sourceVersionHash',
    'catalogHash',
    'documentHash',
    'savedFieldsHash',
    'categorySelectionHash',
    'preservationHash',
    'assetHash',
    'intentHash',
  ]) {
    const value = mutable(upload);
    value[field] = '0'.repeat(64);
    rejected(
      () => assertNativeShortCoverPreSave(before, value as NativeShortCoverUploadIntent),
      'intent_hash_mismatch',
    );
  }
  for (const change of [
    (value: Record<string, any>) => {
      value.asset.policy.fit = 'contain';
    },
    (value: Record<string, any>) => {
      value.serverRevisionBefore.latestVersion = 6;
    },
    (value: Record<string, any>) => {
      value.hashBases.preservation = NATIVE_SHORT_HASH_BASES.preservation;
    },
    (value: Record<string, any>) => {
      value.scope = NATIVE_SHORT_METADATA_SCOPE;
    },
    (value: Record<string, any>) => {
      value.derivedUrlPolicy = 'ignore-url-lists';
    },
    (value: Record<string, any>) => {
      value.serverRevisionPolicy = 'ignore-revisions';
    },
    (value: Record<string, any>) => {
      value.extra = true;
    },
  ]) {
    const value = mutable(upload);
    change(value);
    rejected(() => assertNativeShortCoverPreSave(before, value as NativeShortCoverUploadIntent));
  }
});

test('save planning changes only recommended URI in exact legacy form and never mutates source', () => {
  const before = snapshot(),
    original = JSON.stringify(before),
    upload = intent(before),
    plan = planNativeShortCoverSave(before, upload, ack);
  const old = planNativeShortMetadataUpdate(before, {
    expectedSnapshotVersionHash: before.snapshotVersionHash,
    hashBasis: NATIVE_SHORT_HASH_BASES.snapshot,
    expectedState: 'draft',
    title: before.savedFields.multi_title[0]!,
  });
  const expectedForm: Record<string, string> = { ...old.form, book_thumb_uri: ack.picUri };
  assert.deepEqual(plan.form, expectedForm);
  assert.equal(plan.form.content, html);
  assert.equal(plan.form.thumb_uri, before.savedFields.thumb_uri);
  assert.equal(plan.form.multi_title, JSON.stringify(before.savedFields.multi_title));
  assert.equal(plan.form.category, '10,r1');
  assert.equal(plan.form.item_version, '-1');
  assert.equal(plan.form.sign_type, '1');
  assert.equal(plan.form.activity_flag, '0');
  assert.equal(plan.request.url, nativeShortMetadataEndpoints(target.work.id).save);
  assert.equal(plan.request.contentType, nativeShortMetadataEndpoints(target.work.id).contentType);
  assert.equal(plan.request.method, 'POST');
  assert.equal(plan.atomicRevision, false);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(plan.request.body)), plan.form);
  assert.equal(plan.intentHash, upload.intentHash);
  assert.equal(plan.uploadAckHash, plan.expectation.uploadAckHash);
  assert.equal(plan.desiredContentHash, nativeShortCoverDesiredContentHash(plan.expectation));
  assert.equal(JSON.stringify(before), original);
  assert(Object.isFrozen(plan));
  assert(Object.isFrozen(plan.form));
  assert(Object.isFrozen(plan.request));
  assert(Object.isFrozen(plan.expectation));
  const expectationJson = JSON.stringify(plan.expectation);
  for (const value of [html, ack.picUri, ack.picUrl, before.savedFields.thumb_uri])
    assert(!expectationJson.includes(value));
});

test('empty source category is omitted and both activity scalar encodings survive unchanged save semantics', () => {
  for (const value of [0, '0', 1, '1']) {
    const before = snapshot((input) => {
      input.editData.category = [];
      input.editData.origin_activity_flag = value;
    });
    const upload = intent(before),
      plan = planNativeShortCoverSave(before, upload, ack);
    assert.equal(Object.hasOwn(plan.form, 'category'), false);
    assert.equal(new URLSearchParams(plan.request.body).has('category'), false);
    assert.equal(plan.form.activity_flag, String(value));
    assert.equal(compareNativeShortCoverReadback(plan.expectation, after(before)).matches, true);
  }
});
