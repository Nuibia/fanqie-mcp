import assert from 'node:assert/strict';

import * as proof from '../../src/platform/short-native-cover-proof.js';

import { HTML, sha } from './short-native-cover-proof-work.js';

import { canonicalJson } from '../../src/runtime/store.js';

export function rejected(fn: () => unknown) {
  assert.throws(
    fn,
    (error) => error instanceof proof.NativeShortCoverProofError && !error.message.includes(HTML),
  );
}

export function rehash(context: proof.NativeShortCoverEvidenceContext, index: number) {
  context.refs[index]!.sha256 = sha(`${canonicalJson(context.documents[index]!)}\n`);
}
