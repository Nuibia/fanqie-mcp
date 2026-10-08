import test from 'node:test';

import {
  snapshot,
  intent,
  mutable,
  ack,
  rejected,
  after,
  clone,
  html,
  target,
  changed,
  request,
} from './helpers/short-native-cover-asset.js';

import {
  planNativeShortCoverSave,
  compareNativeShortCoverReadback,
  nativeShortCoverDesiredContentHash,
  type NativeShortCoverExpectation,
  createNativeShortCoverUploadIntent,
} from '../src/platform/short-native-cover.js';

import assert from 'node:assert/strict';

import {
  NATIVE_SHORT_METADATA_SCOPE,
  NATIVE_SHORT_HASH_BASES,
} from '../src/platform/short-native-metadata.js';

test('ACK is exact bounded plain nonempty control-free data; URI and URL are separately hash-bound', () => {
  const before = snapshot(),
    upload = intent(before);
  for (const change of [
    (value: Record<string, any>) => {
      delete value.picUri;
    },
    (value: Record<string, any>) => {
      value.extra = true;
    },
    (value: Record<string, any>) => {
      value.pic_uri = value.picUri;
    },
    (value: Record<string, any>) => {
      value.picUri = '';
    },
    (value: Record<string, any>) => {
      value.picUrl = ' \t ';
    },
    (value: Record<string, any>) => {
      value.picUri += '\n';
    },
    (value: Record<string, any>) => {
      value.picUrl += '\u0000';
    },
    (value: Record<string, any>) => {
      value.picUri += '\u0085';
    },
    (value: Record<string, any>) => {
      value.picUrl = 5;
    },
    (value: Record<string, any>) => {
      value.picUri = 'a'.repeat(8193);
    },
    (value: Record<string, any>) => {
      value.picUrl = '封'.repeat(2731);
    },
  ]) {
    const value = mutable(ack);
    change(value);
    rejected(() => planNativeShortCoverSave(before, upload, value as typeof ack));
  }
  const first = planNativeShortCoverSave(before, upload, ack),
    otherUrl = planNativeShortCoverSave(before, upload, { ...ack, picUrl: 'different opaque URL' });
  assert.notEqual(first.uploadAckHash, otherUrl.uploadAckHash);
  assert.equal(first.expectation.coverUriHash, otherUrl.expectation.coverUriHash);
  assert.notEqual(first.desiredContentHash, otherUrl.desiredContentHash);
  const otherUri = planNativeShortCoverSave(before, upload, { ...ack, picUri: 'different URI' });
  assert.notEqual(first.expectation.coverUriHash, otherUri.expectation.coverUriHash);
});

test('portable expectation accepts only exact cover scope, policies, bases, typed binding, hashes and revision shape', () => {
  const before = snapshot(),
    expected = planNativeShortCoverSave(before, intent(before), ack).expectation,
    observed = after(before);
  assert.equal(compareNativeShortCoverReadback(clone(expected), observed).matches, true);
  assert.equal(
    nativeShortCoverDesiredContentHash(clone(expected)),
    nativeShortCoverDesiredContentHash(expected),
  );
  for (const field of [
    'sourceVersionHash',
    'catalogHash',
    'documentHash',
    'savedFieldsHash',
    'categorySelectionHash',
    'preservationHash',
    'intentHash',
    'assetHash',
    'uploadAckHash',
    'coverUriHash',
  ]) {
    const value = mutable(expected);
    value[field] = 'BAD';
    rejected(() => compareNativeShortCoverReadback(value as NativeShortCoverExpectation, observed));
    rejected(() => nativeShortCoverDesiredContentHash(value as NativeShortCoverExpectation));
    const changedHash = mutable(expected);
    changedHash[field] = '0'.repeat(64);
    assert.notEqual(
      nativeShortCoverDesiredContentHash(changedHash as NativeShortCoverExpectation),
      nativeShortCoverDesiredContentHash(expected),
    );
  }
  for (const change of [
    (value: Record<string, any>) => {
      value.scope = NATIVE_SHORT_METADATA_SCOPE;
    },
    (value: Record<string, any>) => {
      value.hashBases = NATIVE_SHORT_HASH_BASES;
    },
    (value: Record<string, any>) => {
      value.schema = 'other/v1';
    },
    (value: Record<string, any>) => {
      value.hashBases.extra = true;
    },
    (value: Record<string, any>) => {
      value.serverRevisionPolicy = 'another';
    },
    (value: Record<string, any>) => {
      value.derivedUrlPolicy = 'another';
    },
    (value: Record<string, any>) => {
      value.expectedState = 'published';
    },
    (value: Record<string, any>) => {
      value.binding.work.kind = 'book';
    },
    (value: Record<string, any>) => {
      value.binding.account.id = 1001;
    },
    (value: Record<string, any>) => {
      value.binding.work.id = '0';
    },
    (value: Record<string, any>) => {
      value.serverRevisionBefore.latestVersion = '7';
    },
    (value: Record<string, any>) => {
      value.serverRevisionBefore.extra = true;
    },
    (value: Record<string, any>) => {
      value.extra = true;
    },
    (value: Record<string, any>) => {
      delete value.coverUriHash;
    },
  ]) {
    const value = mutable(expected);
    change(value);
    rejected(() => compareNativeShortCoverReadback(value as NativeShortCoverExpectation, observed));
    rejected(() => nativeShortCoverDesiredContentHash(value as NativeShortCoverExpectation));
  }
});

test('readback matches only exact ACK URI with a single revision and nondecreasing ASCII token; URLs stay opaque', () => {
  const before = snapshot(),
    plan = planNativeShortCoverSave(before, intent(before), ack);
  for (const token of ['0000000123', '0000000124', '9999999999']) {
    const observed = after(before, (edit) => {
      edit.modify_time = token;
      edit.book_thumb_url_list = [{}, 'opaque generated token, not ACK URL'];
    });
    const compared = compareNativeShortCoverReadback(plan.expectation, observed);
    assert.equal(compared.matches, true);
    assert.equal(compared.reason, 'match');
    assert.equal(compared.actual.preservationHash, plan.expectation.preservationHash);
    assert.equal(compared.actual.savedFieldsHash, plan.expectation.savedFieldsHash);
    assert.notEqual(compared.actual.snapshotVersionHash, plan.expectation.sourceVersionHash);
    assert.equal(compared.actual.derivedUrlPolicySatisfied, true);
    assert(Object.isFrozen(compared.actual));
    const safe = JSON.stringify(compared);
    for (const privateValue of [html, ack.picUri, 'opaque generated token, not ACK URL'])
      assert(!safe.includes(privateValue));
  }
  assert.equal(
    compareNativeShortCoverReadback(
      plan.expectation,
      after(before, (edit) => {
        edit.book_thumb_uri = 'other URI';
      }),
    ).reason,
    'cover_uri_changed',
  );
  assert.equal(
    compareNativeShortCoverReadback(
      plan.expectation,
      after(before, (edit) => {
        edit.publish_status = 1;
      }),
    ).reason,
    'state_not_draft',
  );
  const account = { ...target, account: { kind: 'account_id' as const, id: '1002' } };
  const rebound = changed(after(before), () => {}, account);
  assert.equal(
    compareNativeShortCoverReadback(plan.expectation, rebound).reason,
    'binding_changed',
  );
});

test('before revision boundary table rejects missing, coerced, invalid and unincrementable revisions', () => {
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
      'string version',
      (edit: Record<string, unknown>) => {
        edit.latest_version = '7';
      },
    ],
    [
      'null version',
      (edit: Record<string, unknown>) => {
        edit.latest_version = null;
      },
    ],
    [
      'negative version',
      (edit: Record<string, unknown>) => {
        edit.latest_version = -1;
      },
    ],
    [
      'fraction version',
      (edit: Record<string, unknown>) => {
        edit.latest_version = 7.5;
      },
    ],
    [
      'unsafe version',
      (edit: Record<string, unknown>) => {
        edit.latest_version = Number.MAX_SAFE_INTEGER + 1;
      },
    ],
    [
      'no increment room',
      (edit: Record<string, unknown>) => {
        edit.latest_version = Number.MAX_SAFE_INTEGER;
      },
    ],
    [
      'numeric token',
      (edit: Record<string, unknown>) => {
        edit.modify_time = 123;
      },
    ],
    [
      'short token',
      (edit: Record<string, unknown>) => {
        edit.modify_time = '000000123';
      },
    ],
    [
      'long token',
      (edit: Record<string, unknown>) => {
        edit.modify_time = '00000000123';
      },
    ],
    [
      'nonASCII token',
      (edit: Record<string, unknown>) => {
        edit.modify_time = '０００００００１２３';
      },
    ],
    [
      'newline token',
      (edit: Record<string, unknown>) => {
        edit.modify_time = '0000000123\n';
      },
    ],
  ] as const) {
    const before = snapshot((input) => mutate(input.editData));
    rejected(
      () => createNativeShortCoverUploadIntent(before, request(before)),
      'server_revision_shape',
    );
  }
});
