import test from 'node:test';

import {
  snapshot,
  intent,
  ack,
  after,
  mutable,
  rejected,
  request,
} from './helpers/short-native-cover-asset.js';

import {
  planNativeShortCoverSave,
  compareNativeShortCoverReadback,
  createNativeShortCoverUploadIntent,
} from '../src/platform/short-native-cover.js';

import assert from 'node:assert/strict';

import { type NativeShortMetadataSnapshot } from '../src/platform/short-native-metadata.js';

test('after revision boundary table cannot match or mask unproven server deltas', () => {
  for (const [_name, mutate] of [
    [
      'missing version',
      (edit: Record<string, unknown>) => {
        delete edit.latest_version;
      },
    ],
    [
      'missing token',
      (edit: Record<string, unknown>) => {
        delete edit.modify_time;
      },
    ],
    [
      'zero delta',
      (edit: Record<string, unknown>) => {
        edit.latest_version = 7;
      },
    ],
    [
      'double delta',
      (edit: Record<string, unknown>) => {
        edit.latest_version = 9;
      },
    ],
    [
      'negative delta',
      (edit: Record<string, unknown>) => {
        edit.latest_version = 6;
      },
    ],
    [
      'string version',
      (edit: Record<string, unknown>) => {
        edit.latest_version = '8';
      },
    ],
    [
      'null version',
      (edit: Record<string, unknown>) => {
        edit.latest_version = null;
      },
    ],
    [
      'fraction version',
      (edit: Record<string, unknown>) => {
        edit.latest_version = 8.5;
      },
    ],
    [
      'unsafe version',
      (edit: Record<string, unknown>) => {
        edit.latest_version = Number.MAX_SAFE_INTEGER + 1;
      },
    ],
    [
      'decreased token',
      (edit: Record<string, unknown>) => {
        edit.modify_time = '0000000122';
      },
    ],
    [
      'invalid token',
      (edit: Record<string, unknown>) => {
        edit.modify_time = '000000012x';
      },
    ],
    [
      'newline token',
      (edit: Record<string, unknown>) => {
        edit.modify_time = '0000000124\n';
      },
    ],
  ] as const) {
    const before = snapshot(),
      plan = planNativeShortCoverSave(before, intent(before), ack),
      compared = compareNativeShortCoverReadback(plan.expectation, after(before, mutate));
    assert.equal(compared.matches, false);
    assert.equal(compared.reason, 'server_revision_not_proven');
    assert.notEqual(compared.actual.preservationHash, plan.expectation.preservationHash);
  }
});

test('revision boundary permits max-safe exact +1 and rejects malformed raw descriptor revision carriers', () => {
  const before = snapshot((input) => {
    input.editData.latest_version = Number.MAX_SAFE_INTEGER - 1;
    input.editData.modify_time = '9999999999';
  });
  const plan = planNativeShortCoverSave(before, intent(before), ack);
  assert.equal(
    compareNativeShortCoverReadback(
      plan.expectation,
      after(before, (edit) => {
        edit.latest_version = Number.MAX_SAFE_INTEGER;
        edit.modify_time = '9999999999';
      }),
    ).matches,
    true,
  );
  let calls = 0;
  for (const mode of ['getter', 'symbol', 'nonenumerable', 'negative-zero']) {
    const forged = mutable(before);
    if (mode === 'getter')
      Object.defineProperty(forged.editData, 'latest_version', {
        enumerable: true,
        get() {
          calls++;
          return 7;
        },
      });
    if (mode === 'symbol') Object.defineProperty(forged.editData, Symbol('revision'), { value: 7 });
    if (mode === 'nonenumerable')
      Object.defineProperty(forged.editData, 'modify_time', {
        value: '0000000123',
        enumerable: false,
      });
    if (mode === 'negative-zero') forged.editData.latest_version = -0;
    rejected(() =>
      compareNativeShortCoverReadback(plan.expectation, forged as NativeShortMetadataSnapshot),
    );
  }
  assert.equal(calls, 0);
});

test('URL policy requires own bounded array; empty baseline allows a first cover but after needs nonempty string/object entries', () => {
  const before = snapshot((input) => {
    input.editData.book_thumb_url_list = [];
    input.editData.book_thumb_uri = '';
  });
  const plan = planNativeShortCoverSave(before, intent(before), ack);
  assert.equal(compareNativeShortCoverReadback(plan.expectation, after(before)).matches, true);
  for (const list of [
    undefined,
    null,
    'scalar',
    8,
    false,
    [],
    [null],
    [1],
    [false],
    [[]],
    [''],
    ['   '],
  ]) {
    const observed = after(before, (edit) => {
      if (list === undefined) delete edit.book_thumb_url_list;
      else edit.book_thumb_url_list = list;
    });
    const compared = compareNativeShortCoverReadback(plan.expectation, observed);
    assert.equal(compared.matches, false);
    assert.equal(compared.reason, 'derived_urls_not_proven');
    assert.equal(compared.actual.derivedUrlPolicySatisfied, false);
    assert.notEqual(compared.actual.preservationHash, plan.expectation.preservationHash);
  }
  for (const list of [undefined, null, 'scalar', [null]]) {
    const invalid = snapshot((input) => {
      if (list === undefined) delete input.editData.book_thumb_url_list;
      else input.editData.book_thumb_url_list = list;
    });
    rejected(
      () => createNativeShortCoverUploadIntent(invalid, request(invalid)),
      'derived_urls_not_proven',
    );
  }
  let invoked = 0;
  for (const mode of ['inherited', 'getter', 'sparse', 'object-accessor']) {
    const forged = mutable(after(before));
    if (mode === 'inherited') {
      delete forged.editData.book_thumb_url_list;
      Object.setPrototypeOf(forged.editData, { book_thumb_url_list: ['inherited'] });
    }
    if (mode === 'getter')
      Object.defineProperty(forged.editData, 'book_thumb_url_list', {
        enumerable: true,
        get() {
          invoked++;
          return ['getter'];
        },
      });
    if (mode === 'sparse') forged.editData.book_thumb_url_list = [, 'url'];
    if (mode === 'object-accessor')
      forged.editData.book_thumb_url_list = [
        Object.defineProperty({}, 'main_url', {
          enumerable: true,
          get() {
            invoked++;
            return 'getter';
          },
        }),
      ];
    rejected(() =>
      compareNativeShortCoverReadback(plan.expectation, forged as NativeShortMetadataSnapshot),
    );
  }
  assert.equal(invoked, 0);
});
