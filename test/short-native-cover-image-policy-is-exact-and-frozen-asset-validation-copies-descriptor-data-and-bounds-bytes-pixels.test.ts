import test from 'node:test';

import assert from 'node:assert/strict';

import {
  nativeShortCoverImagePolicy,
  NATIVE_SHORT_COVER_LIMITS,
  validateNativeShortCoverAsset,
  planNativeShortCoverSave,
  createNativeShortCoverUploadIntent,
  assertNativeShortCoverPreSave,
  compareNativeShortCoverReadback,
  NATIVE_SHORT_COVER_SCOPE,
  NATIVE_SHORT_COVER_HASH_BASES,
  NATIVE_SHORT_COVER_DERIVED_URL_POLICY,
  NATIVE_SHORT_COVER_SERVER_REVISION_POLICY,
} from '../src/platform/short-native-cover.js';

import {
  rejected,
  asset,
  mutable,
  snapshot,
  intent,
  ack,
  request,
  after,
  sha,
  html,
  clone,
} from './helpers/short-native-cover-asset.js';

import {
  NATIVE_SHORT_HASH_BASES,
  NATIVE_SHORT_METADATA_SCOPE,
} from '../src/platform/short-native-metadata.js';

test('image policy is exact and frozen; asset validation copies descriptor data and bounds bytes/pixels', () => {
  assert.deepEqual(nativeShortCoverImagePolicy(), {
    version: 'center-cover-or-white-contain/v1',
    fit: 'cover',
    width: 600,
    height: 800,
    mimeType: 'image/jpeg',
    quality: 0.9,
  });
  assert.equal(nativeShortCoverImagePolicy('contain').fit, 'contain');
  assert(Object.isFrozen(nativeShortCoverImagePolicy()));
  assert(Object.isFrozen(NATIVE_SHORT_COVER_LIMITS));
  rejected(() => nativeShortCoverImagePolicy('stretch' as 'cover'), 'image_fit');
  const input = asset(),
    checked = validateNativeShortCoverAsset(input);
  assert.notEqual(input, checked);
  assert.notEqual(input.policy, checked.policy);
  assert(Object.isFrozen(checked));
  assert(Object.isFrozen(checked.policy));
  (input as { sourceSize: number }).sourceSize = 1;
  assert.equal(checked.sourceSize, 1234);
  const edge = asset();
  Object.assign(edge, {
    sourceSize: NATIVE_SHORT_COVER_LIMITS.sourceBytes,
    preparedSize: NATIVE_SHORT_COVER_LIMITS.preparedBytes,
    sourceWidth: 4096,
    sourceHeight: 4096,
  });
  assert.equal(
    validateNativeShortCoverAsset(edge).sourceWidth * edge.sourceHeight,
    NATIVE_SHORT_COVER_LIMITS.sourcePixels,
  );
});

test('asset boundary table rejects invalid descriptor shape, hashes, formats, dimensions and policy', () => {
  for (const [_name, mutate] of [
    [
      'extra asset key',
      (value: Record<string, any>) => {
        value.uploadPath = 'not-a-public-field';
      },
    ],
    [
      'missing hash',
      (value: Record<string, any>) => {
        delete value.sourceSha256;
      },
    ],
    [
      'uppercase hash',
      (value: Record<string, any>) => {
        value.sourceSha256 = value.sourceSha256.toUpperCase();
      },
    ],
    [
      'short hash',
      (value: Record<string, any>) => {
        value.preparedSha256 = 'a'.repeat(63);
      },
    ],
    [
      'wrong MIME',
      (value: Record<string, any>) => {
        value.sourceMimeType = 'image/webp';
      },
    ],
    [
      'coerced source bytes',
      (value: Record<string, any>) => {
        value.sourceSize = '1234';
      },
    ],
    [
      'zero prepared bytes',
      (value: Record<string, any>) => {
        value.preparedSize = 0;
      },
    ],
    [
      'oversize source',
      (value: Record<string, any>) => {
        value.sourceSize = NATIVE_SHORT_COVER_LIMITS.sourceBytes + 1;
      },
    ],
    [
      'oversize prepared',
      (value: Record<string, any>) => {
        value.preparedSize = NATIVE_SHORT_COVER_LIMITS.preparedBytes + 1;
      },
    ],
    [
      'negative dimensions',
      (value: Record<string, any>) => {
        value.sourceWidth = -1;
      },
    ],
    [
      'fraction dimensions',
      (value: Record<string, any>) => {
        value.sourceHeight = 1.5;
      },
    ],
    [
      'unsafe dimensions',
      (value: Record<string, any>) => {
        value.sourceHeight = Number.MAX_SAFE_INTEGER + 1;
      },
    ],
    [
      'pixel budget',
      (value: Record<string, any>) => {
        value.sourceWidth = 4096;
        value.sourceHeight = 4097;
      },
    ],
    [
      'extra policy key',
      (value: Record<string, any>) => {
        value.policy.background = 'white';
      },
    ],
    [
      'wrong policy revision',
      (value: Record<string, any>) => {
        value.policy.version = 'another/v1';
      },
    ],
    [
      'wrong width',
      (value: Record<string, any>) => {
        value.policy.width = 599;
      },
    ],
    [
      'wrong quality',
      (value: Record<string, any>) => {
        value.policy.quality = 1;
      },
    ],
    [
      'wrong output MIME',
      (value: Record<string, any>) => {
        value.policy.mimeType = 'image/png';
      },
    ],
  ] as const) {
    const value = mutable(asset());
    mutate(value);
    rejected(() => validateNativeShortCoverAsset(value));
  }
});

test('descriptor checks reject getters without invoking them on every outer carrier and nested policy', () => {
  let invoked = 0;
  const before = snapshot(),
    upload = intent(before),
    expected = planNativeShortCoverSave(before, upload, ack).expectation;
  const attacks: Array<[unknown, string, (value: any) => unknown]> = [
    [mutable(asset()), 'sourceSha256', (value) => validateNativeShortCoverAsset(value)],
    [
      mutable(request(before)),
      'asset',
      (value) => createNativeShortCoverUploadIntent(before, value),
    ],
    [mutable(before), 'editData', (value) => assertNativeShortCoverPreSave(value, upload)],
    [mutable(before), 'state', (value) => assertNativeShortCoverPreSave(value, upload)],
    [mutable(upload), 'asset', (value) => assertNativeShortCoverPreSave(before, value)],
    [mutable(ack), 'picUri', (value) => planNativeShortCoverSave(before, upload, value)],
    [mutable(expected), 'scope', (value) => compareNativeShortCoverReadback(value, after(before))],
  ];
  for (const [value, field, action] of attacks) {
    Object.defineProperty(value, field, {
      enumerable: true,
      get() {
        invoked++;
        return 'attacker';
      },
    });
    rejected(() => action(value));
  }
  const policyAsset = mutable(asset());
  Object.defineProperty(policyAsset.policy, 'quality', {
    enumerable: true,
    get() {
      invoked++;
      return 0.9;
    },
  });
  rejected(() => validateNativeShortCoverAsset(policyAsset));
  assert.equal(invoked, 0);
});

test('bounded JSON rejects inherited/nonenumerable/symbol/toJSON/cycle/sparse/invalid unicode and negative zero', () => {
  const cases: Array<(value: Record<string, any>) => void> = [
    (value) => Object.setPrototypeOf(value, { extra: true }),
    (value) => Object.defineProperty(value, 'sourceSize', { value: 1234, enumerable: false }),
    (value) => Object.defineProperty(value, Symbol('private'), { value: true }),
    (value) => {
      value.toJSON = () => asset();
    },
    (value) => {
      value.policy.self = value;
    },
    (value) => {
      value.extra = [1, , 3];
    },
    (value) => {
      value.extra = Object.assign([], { extra: 1 });
    },
    (value) => {
      value.extra = '\ud800';
    },
    (value) => {
      value['\ud800'] = true;
    },
    (value) => {
      value.sourceSize = -0;
    },
    (value) => {
      value.extra = Number.NaN;
    },
    (value) => {
      value.extra = 'a'.repeat(65537);
    },
    (value) => {
      let deep: Record<string, any> = value;
      for (let i = 0; i < 70; i++) {
        deep.next = {};
        deep = deep.next;
      }
    },
  ];
  for (const change of cases) {
    const value = mutable(asset());
    change(value);
    rejected(() => validateNativeShortCoverAsset(value));
  }
});

test('new intent binds complete source, typed target, conversion policy and asset while preserving legacy bases', () => {
  const before = snapshot(),
    legacyJson = JSON.stringify(before),
    oldBases = JSON.stringify(NATIVE_SHORT_HASH_BASES),
    prepared = asset();
  const upload = createNativeShortCoverUploadIntent(before, request(before, prepared));
  assert.equal(upload.scope, NATIVE_SHORT_COVER_SCOPE);
  assert.notEqual(upload.scope, NATIVE_SHORT_METADATA_SCOPE);
  assert.deepEqual(upload.hashBases, NATIVE_SHORT_COVER_HASH_BASES);
  assert.equal(upload.hashBases.sourceSnapshot, NATIVE_SHORT_HASH_BASES.snapshot);
  assert.equal(upload.sourceVersionHash, before.snapshotVersionHash);
  assert.equal(upload.savedFieldsHash, before.savedFieldsHash);
  assert.equal(upload.documentHash, sha(html));
  assert.equal(upload.derivedUrlPolicy, NATIVE_SHORT_COVER_DERIVED_URL_POLICY);
  assert.equal(upload.serverRevisionPolicy, NATIVE_SHORT_COVER_SERVER_REVISION_POLICY);
  assert.deepEqual(upload.serverRevisionBefore, { latestVersion: 7, modifyTime: '0000000123' });
  assertNativeShortCoverPreSave(before, upload);
  assertNativeShortCoverPreSave(clone(before), clone(upload));
  assert(Object.isFrozen(upload));
  assert(Object.isFrozen(upload.asset.policy));
  assert(Object.isFrozen(upload.serverRevisionBefore));
  assert.equal(JSON.stringify(before), legacyJson);
  assert.equal(JSON.stringify(NATIVE_SHORT_HASH_BASES), oldBases);
  assert.notEqual(
    upload.intentHash,
    createNativeShortCoverUploadIntent(before, request(before, asset('contain'))).intentHash,
  );
  const differentBytes = asset();
  Object.assign(differentBytes, { preparedSha256: sha('other-prepared'), preparedSize: 988 });
  assert.notEqual(
    upload.assetHash,
    createNativeShortCoverUploadIntent(before, request(before, differentBytes)).assetHash,
  );
});
