import assert from 'node:assert/strict';

import * as proof from '../../src/platform/short-native-trial-proof.js';

import { HTML, sha } from './short-native-trial-proof-service.js';

import { canonicalJson } from '../../src/runtime/store.js';

export function rejected(fn: () => unknown) {
  assert.throws(
    fn,
    (error) => error instanceof proof.NativeShortTrialProofError && !error.message.includes(HTML),
  );
}

export function rehash(context: proof.NativeShortTrialContext, index: number) {
  context.refs[index]!.sha256 = sha(`${canonicalJson(context.documents[index]!)}\n`);
}
