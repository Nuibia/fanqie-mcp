import { type CoreDependencies } from './core.js';
import { type ApplicationServices } from './services.js';
import { createRefsFor } from './refs-for.js';
import { createUnavailableNativeView } from './unavailable-native-view.js';
import { createPublicJob } from './public-job.js';
import { createIsExplicitBodyRead } from './is-explicit-body-read.js';
import { createExplicitBodyReadView } from './explicit-body-read-view.js';
import { createJobManifest } from './job-manifest.js';
import { createNativeOriginalContext } from './native-original-context.js';
import { createNativeReconciliationContext } from './native-reconciliation-context.js';
import { createNativeClosureContext } from './native-closure-context.js';
export function composeEvidenceContext(
  core: CoreDependencies,
  services: ApplicationServices,
): void {
  services.refsFor = createRefsFor({
    get store() {
      return core.store;
    },
  });
  services.unavailableNativeView = createUnavailableNativeView({});
  services.publicJob = createPublicJob({
    get store() {
      return core.store;
    },
    get config() {
      return core.config;
    },
  });
  services.isExplicitBodyRead = createIsExplicitBodyRead({
    get explicitBodyReadKey() {
      return core.explicitBodyReadKey;
    },
  });
  services.explicitBodyReadView = createExplicitBodyReadView({
    get config() {
      return core.config;
    },
    get store() {
      return core.store;
    },
  });
  services.jobManifest = createJobManifest({
    get store() {
      return core.store;
    },
    get config() {
      return core.config;
    },
    get isExplicitBodyRead() {
      return services.isExplicitBodyRead;
    },
  });
  services.nativeOriginalContext = createNativeOriginalContext({
    get store() {
      return core.store;
    },
    get refsFor() {
      return services.refsFor;
    },
    get config() {
      return core.config;
    },
  });
  services.nativeReconciliationContext = createNativeReconciliationContext({
    get store() {
      return core.store;
    },
    get nativeOriginalContext() {
      return services.nativeOriginalContext;
    },
    get config() {
      return core.config;
    },
  });
  services.nativeClosureContext = createNativeClosureContext({
    get store() {
      return core.store;
    },
    get config() {
      return core.config;
    },
    get refsFor() {
      return services.refsFor;
    },
    get nativeReconciliationContext() {
      return services.nativeReconciliationContext;
    },
    get jobManifest() {
      return services.jobManifest;
    },
  });
}
