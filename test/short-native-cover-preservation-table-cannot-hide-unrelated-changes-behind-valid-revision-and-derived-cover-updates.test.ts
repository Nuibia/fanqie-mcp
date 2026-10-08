import test from 'node:test';

import {
  snapshot,
  intent,
  ack,
  after,
  request,
  sha,
  clone,
  rejected,
  mutable,
} from './helpers/short-native-cover-asset.js';

import {
  planNativeShortCoverSave,
  compareNativeShortCoverReadback,
  createNativeShortCoverUploadIntent,
  assertNativeShortCoverPreSave,
  type NativeShortCoverExpectation,
  nativeShortCoverDesiredContentHash,
} from '../src/platform/short-native-cover.js';

import assert from 'node:assert/strict';

import { type NativeShortMetadataSnapshot } from '../src/platform/short-native-metadata.js';

test('preservation table cannot hide unrelated changes behind valid revision and derived cover updates', () => {
  for (const [name, change, reason] of [
    [
      'primary title',
      (edit: Record<string, unknown>) => {
        (edit.multi_title as string[])[0] = 'other';
      },
      'saved_fields_changed',
    ],
    [
      'tail title',
      (edit: Record<string, unknown>) => {
        (edit.multi_title as string[])[2] = 'other';
      },
      'saved_fields_changed',
    ],
    [
      'document byte',
      (edit: Record<string, unknown>) => {
        edit.content += ' ';
      },
      'document_changed',
    ],
    [
      'story head URI',
      (edit: Record<string, unknown>) => {
        edit.thumb_uri = 'other';
      },
      'saved_fields_changed',
    ],
    [
      'story head URL',
      (edit: Record<string, unknown>) => {
        edit.thumb_url_list = ['other'];
      },
      'preservation_not_proven',
    ],
    [
      'story head URL deletion',
      (edit: Record<string, unknown>) => {
        delete edit.thumb_url_list;
      },
      'preservation_not_proven',
    ],
    [
      'category ID type',
      (edit: Record<string, unknown>) => {
        (edit.category as Array<Record<string, unknown>>)[0]!.category_id = '10';
      },
      'category_selection_changed',
    ],
    [
      'category label',
      (edit: Record<string, unknown>) => {
        (edit.category as Array<Record<string, unknown>>)[0]!.label = 'other';
      },
      'category_selection_changed',
    ],
    [
      'category extra raw',
      (edit: Record<string, unknown>) => {
        (edit.category as Array<Record<string, unknown>>)[0]!.opaque = ['other'];
      },
      'preservation_not_proven',
    ],
    [
      'raw scalar type',
      (edit: Record<string, unknown>) => {
        edit.sign_type = 1;
      },
      'preservation_not_proven',
    ],
    [
      'raw activity type',
      (edit: Record<string, unknown>) => {
        edit.origin_activity_flag = 0;
      },
      'preservation_not_proven',
    ],
    [
      'unknown deletion',
      (edit: Record<string, unknown>) => {
        delete edit.description;
      },
      'preservation_not_proven',
    ],
    [
      'unknown addition',
      (edit: Record<string, unknown>) => {
        edit.new_server_field = null;
      },
      'preservation_not_proven',
    ],
    [
      'nested revision',
      (edit: Record<string, unknown>) => {
        (edit.unknown_metadata as Record<string, unknown>).latest_version = 8;
      },
      'preservation_not_proven',
    ],
    [
      'nested timestamp',
      (edit: Record<string, unknown>) => {
        (edit.unknown_metadata as Record<string, unknown>).modify_time = 'new';
      },
      'preservation_not_proven',
    ],
    [
      'unknown scalar type',
      (edit: Record<string, unknown>) => {
        edit.use_ai = '2';
      },
      'preservation_not_proven',
    ],
  ] as const) {
    const before = snapshot(),
      plan = planNativeShortCoverSave(before, intent(before), ack);
    const compared = compareNativeShortCoverReadback(plan.expectation, after(before, change));
    assert.equal(compared.matches, false, name);
    assert.equal(compared.reason, reason, name);
  }
});

test('all catalog raw is preserved even when selected category and labels stay unchanged', () => {
  const before = snapshot(),
    plan = planNativeShortCoverSave(before, intent(before), ack);
  for (const change of [
    (categories: Record<string, unknown>) => {
      categories.new_field = true;
    },
    (categories: Record<string, unknown>) => {
      delete categories.unknown_catalog;
    },
    (categories: Record<string, unknown>) => {
      (categories.unknown_catalog as Record<string, unknown>).latest_version = 1000;
    },
    (categories: Record<string, unknown>) => {
      (categories.category_list as Array<Record<string, unknown>>)[0]!.extra = false;
    },
  ]) {
    const compared = compareNativeShortCoverReadback(
      plan.expectation,
      after(before, (_edit, categories) => change(categories)),
    );
    assert.equal(compared.matches, false);
    assert.equal(compared.reason, 'catalog_changed');
  }
});

test('caller mutation, key order and null-prototype portable copies cannot change or weaken sealed intent/expectation', () => {
  const before = snapshot(),
    input = request(before),
    upload = createNativeShortCoverUploadIntent(before, input),
    originalHash = upload.intentHash;
  Object.assign(input.asset, { preparedSha256: sha('mutated'), preparedSize: 1 });
  assert.equal(upload.intentHash, originalHash);
  assertNativeShortCoverPreSave(before, upload);
  const inputAck = { ...ack },
    plan = planNativeShortCoverSave(before, upload, inputAck);
  inputAck.picUri = 'mutated';
  assert.equal(plan.form.book_thumb_uri, ack.picUri);
  const shuffled = Object.fromEntries(
    Object.entries(clone(plan.expectation)).reverse(),
  ) as unknown as NativeShortCoverExpectation;
  assert.equal(nativeShortCoverDesiredContentHash(shuffled), plan.desiredContentHash);
  const nullObject = Object.assign(
    Object.create(null),
    clone(plan.expectation),
  ) as NativeShortCoverExpectation;
  assert.equal(compareNativeShortCoverReadback(nullObject, after(before)).matches, true);
});

test('own __proto__ raw JSON remains part of full preservation without prototype pollution', () => {
  const before = snapshot((input) => {
    Object.defineProperty(input.editData, '__proto__', {
      value: { synthetic: true },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  });
  const plan = planNativeShortCoverSave(before, intent(before), ack);
  assert.equal(compareNativeShortCoverReadback(plan.expectation, after(before)).matches, true);
  const changedRaw = after(before, (edit) => {
    Object.defineProperty(edit, '__proto__', {
      value: { synthetic: false },
      enumerable: true,
      writable: true,
      configurable: true,
    });
  });
  assert.equal(
    compareNativeShortCoverReadback(plan.expectation, changedRaw).reason,
    'preservation_not_proven',
  );
  assert.equal(Object.hasOwn(Object.prototype, 'synthetic'), false);
});

test('cover upload and save require exact current draft facts and after comparison rejects every other publication branch', () => {
  const before = snapshot(),
    upload = intent(before),
    plan = planNativeShortCoverSave(before, upload, ack);
  for (const [publish, display, state] of [
    [1, 1, 'published'],
    [1, 5, 'reviewing'],
    [1, 7, 'rejected'],
    [1, 10, 'waiting_publication'],
    [1, 12, 'distribution_stopped'],
    [1, undefined, 'unknown'],
    [0, 1, 'unknown'],
    ['0', undefined, 'unknown'],
  ] as const) {
    const current = snapshot((input) => {
      input.editData.publish_status = publish;
      if (display !== undefined) input.editData.display_status = display;
    });
    assert.equal(current.state, state);
    assert.equal(current.statusFacts.draftEditable, false);
    rejected(
      () => createNativeShortCoverUploadIntent(current, request(current)),
      'state_not_draft',
    );
    rejected(() => planNativeShortCoverSave(current, upload, ack), 'state_not_draft');
    assert.equal(
      compareNativeShortCoverReadback(
        plan.expectation,
        after(before, (edit) => {
          edit.publish_status = publish;
          if (display !== undefined) edit.display_status = display;
        }),
      ).reason,
      'state_not_draft',
    );
  }
  const missingMarker = mutable(before);
  delete missingMarker.statusFacts;
  rejected(() =>
    createNativeShortCoverUploadIntent(
      missingMarker as NativeShortMetadataSnapshot,
      request(before),
    ),
  );
  const forged = mutable(before);
  forged.statusFacts.draftEditable = false;
  rejected(() => planNativeShortCoverSave(forged as NativeShortMetadataSnapshot, upload, ack));
});
