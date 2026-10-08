import { type JobStatus } from './runtime-error.js';
import {
  type NativeShortBodyAuthorityBinding,
  type ServiceLeaseLostSignal,
} from './native-closure-signal.js';
import * as bodyProof from '../../platform/short-native-body-proof.js';

import { type Store } from './authority.js';
export interface StoreGlobals {
  WRITE_TASK_STATUSES: Set<JobStatus>;
  terminal: Set<JobStatus>;
  nativeCompensationExecutionInventoryHash: '8b651ddfd339d1d0139de427aed885017b7987404b7a26f98705a6fb688e0a3b';
  nativeCompensationSourcePaths: readonly [
    'src/application.ts',
    'src/config.ts',
    'src/errors.ts',
    'src/index.ts',
    'src/platform/browser.ts',
    'src/platform/chapter-body.ts',
    'src/platform/chapter-directory.ts',
    'src/platform/public.ts',
    'src/platform/reads.ts',
    'src/platform/short-metadata-api-schema.ts',
    'src/platform/short-metadata-schema.ts',
    'src/platform/short-native-metadata-api.ts',
    'src/platform/short-native-metadata-proof.ts',
    'src/platform/short-native-metadata.ts',
    'src/platform/writes.ts',
    'src/runtime/jobs.ts',
    'src/runtime/login-fallback.ts',
    'src/runtime/store.ts',
    'src/transport/http.ts',
    'src/transport/mcp.ts',
    'test/application.test.ts',
    'test/chapter-body.test.ts',
    'test/chapter-directory.test.ts',
    'test/current-chapter-tab-structure.test.ts',
    'test/login-fallback.test.ts',
    'test/manifest-commit-crash.test.ts',
    'test/platform-reads.test.ts',
    'test/platform-writes.test.ts',
    'test/public-content-fingerprint.test.ts',
    'test/runtime-readiness.test.ts',
    'test/runtime.test.ts',
    'test/short-native-metadata-api.test.ts',
    'test/short-native-metadata-integration.test.ts',
    'test/short-native-metadata.test.ts',
    'test/transport.test.ts',
  ];
  nativeShortBodyStores: WeakSet<Store>;
  nativeShortBodyAuthorities: WeakMap<object, NativeShortBodyAuthorityBinding>;
  nativeShortBodyPermits: WeakMap<
    object,
    { store: Store; jobId: string; ref: bodyProof.NativeShortBodyRefLink; consumed: boolean }
  >;
  serviceLeaseLostSignal: ServiceLeaseLostSignal;
}
