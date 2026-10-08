import assert from 'node:assert/strict';

import { CRASH_OPERATION_TIMEOUT_MS } from './helpers/short-native-body-public-account.js';

import { fixture } from './helpers/short-native-body-public-fixture.js';

if (process.env.FQ_BODY_PUBLIC_CHILD) {
  const mode = process.env.FQ_BODY_PUBLIC_CHILD;
  assert(mode === 'death-attempt' || mode === 'death-ack');
  assert(process.env.FQ_BODY_PUBLIC_CHILD_DIR);
  const f = fixture({
    mode,
    dir: process.env.FQ_BODY_PUBLIC_CHILD_DIR!,
    keep: true,
    timeoutMs: CRASH_OPERATION_TIMEOUT_MS,
  });
  await f.call('update_short_body', f.request());
  throw Error('Synthetic child unexpectedly passed checkpoint');
}

// Preserve the installed-source registration entry; scenarios register tests in their own files.
import type {} from './short-native-body-public-body-public-authentication-and-no-store-protect-explicit-body-response.test.js';
import type {} from './short-native-body-public-body-public-fixture-constructor-cannot-prove-live-or-fall-back-to-default-transport.test.js';
import type {} from './short-native-body-public-body-public-process-death-after-committed-attempt-recovers-unknown-without-replay.test.js';
import type {} from './short-native-body-public-body-public-sdk-lists-exact-strict-read-and-write-schemas.test.js';
import type {} from './short-native-body-public-body-public-sdk-save-creates-one-real-sql-attempt-and-seven-stage-graph.test.js';
export type { FixtureOptions } from './helpers/short-native-body-public-account.js';
export type { BrowserInternals } from './helpers/short-native-body-public-account.js';
