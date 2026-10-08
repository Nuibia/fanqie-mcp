import {
  canonicalJson,
  nativeReconciliationUnavailable,
  sameNativeValue,
  hash,
} from '../native-closure-signal.js';
import { PublicReadCoordinator } from '../../public-read.js';
import { type NativeShortCompensationAuthority } from '../../../platform/short-native-metadata-proof.js';
import {
  type ValidateNativeCompensationSourceIdentityOperation,
  type ValidateNativeCompensationInstalledSourceOperation,
} from '../contracts/native-compensation-validate-native-compensation-source-identity.js';

import { fileURLToPath } from 'node:url';
import {
  installedSourceInventory,
  SourceIntegrityError,
  installedSourceRegistrationHash,
} from '../../source-integrity.js';

interface ValidateNativeCompensationSourceIdentityDependencies {
  publicReads: PublicReadCoordinator;
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
}

export function createValidateNativeCompensationSourceIdentity(
  deps: ValidateNativeCompensationSourceIdentityDependencies,
): ValidateNativeCompensationSourceIdentityOperation {
  function validateNativeCompensationSourceIdentity(
    authority: NativeShortCompensationAuthority,
  ): void {
    return deps.publicReads.memo(
      'store.validateNativeCompensationSourceIdentity',
      [authority],
      () => {
        if (
          !authority?.source ||
          hash(canonicalJson(authority.source.executionInventory)) !==
            deps.nativeCompensationExecutionInventoryHash ||
          authority.source.executionManifestSha256 !==
            '6d22f3e179b4092c7efd8d1efbdb3e86614150c73b61c7d1793d302c55f6dbb6' ||
          typeof authority.source.registrationManifestSha256 !== 'string' ||
          authority.source.registrationManifestSha256.length !== 64 ||
          !/^[a-f0-9]{64}$/.test(authority.source.registrationManifestSha256) ||
          !sameNativeValue(
            Object.keys(authority.source.registrationInventory).sort(),
            deps.nativeCompensationSourcePaths,
          ) ||
          Object.values(authority.source.registrationInventory).some(
            (value) =>
              typeof value !== 'string' || value.length !== 64 || !/^[a-f0-9]{64}$/.test(value),
          )
        )
          return nativeReconciliationUnavailable();
      },
    );
  }
  return validateNativeCompensationSourceIdentity;
}

interface ValidateNativeCompensationInstalledSourceDependencies {
  publicReads: PublicReadCoordinator;
  validateNativeCompensationSourceIdentity: ValidateNativeCompensationSourceIdentityOperation;
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
}

export function createValidateNativeCompensationInstalledSource(
  deps: ValidateNativeCompensationInstalledSourceDependencies,
): ValidateNativeCompensationInstalledSourceOperation {
  function validateNativeCompensationInstalledSource(
    authority: NativeShortCompensationAuthority,
  ): void {
    return deps.publicReads.memo(
      'store.validateNativeCompensationInstalledSource',
      [authority],
      () => {
        deps.validateNativeCompensationSourceIdentity(authority);
        const packageRoot = fileURLToPath(
          new URL('../../', new URL('../../store.ts', import.meta.url).href),
        );
        const inventory = deps.publicReads.file(
          ['installed-source-inventory', packageRoot],
          (mark) => {
            try {
              return installedSourceInventory(packageRoot, mark);
            } catch (error) {
              if (error instanceof SourceIntegrityError) return nativeReconciliationUnavailable();
              throw error;
            }
          },
        );
        for (const relative of deps.nativeCompensationSourcePaths) {
          if (
            installedSourceRegistrationHash(relative, inventory) !==
            authority.source.registrationInventory[relative]
          )
            return nativeReconciliationUnavailable();
        }
      },
    );
  }
  return validateNativeCompensationInstalledSource;
}
