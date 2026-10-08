import { type CoreDependencies } from './core.js';
import { type ApplicationServices } from './services.js';
import { createUnavailableDirectoryProjection } from './unavailable-directory-projection.js';
import { createDirectoryView } from './directory-view.js';
import { createEvidenceView } from './evidence-view.js';
import { createOutputJob } from './output-job.js';
import { createListedJob } from './listed-job.js';
export function composeEvidenceProjection(
  core: CoreDependencies,
  services: ApplicationServices,
): void {
  services.unavailableDirectoryProjection = createUnavailableDirectoryProjection({});
  services.directoryView = createDirectoryView({
    get store() {
      return core.store;
    },
    get config() {
      return core.config;
    },
    get directoryApplicationOrigin() {
      return core.directoryApplicationOrigin;
    },
    get unavailableDirectoryProjection() {
      return services.unavailableDirectoryProjection;
    },
  });
  services.evidenceView = createEvidenceView({
    get store() {
      return core.store;
    },
    get isExplicitBodyRead() {
      return services.isExplicitBodyRead;
    },
    get explicitBodyReadView() {
      return services.explicitBodyReadView;
    },
    get config() {
      return core.config;
    },
    get directoryView() {
      return services.directoryView;
    },
    get nativeClosureContext() {
      return services.nativeClosureContext;
    },
    get nativeReconciliationContext() {
      return services.nativeReconciliationContext;
    },
    get unavailableNativeView() {
      return services.unavailableNativeView;
    },
  });
  services.outputJob = createOutputJob({
    get publicJob() {
      return services.publicJob;
    },
    get jobManifest() {
      return services.jobManifest;
    },
    get refsFor() {
      return services.refsFor;
    },
    get evidenceView() {
      return services.evidenceView;
    },
  });
  services.listedJob = createListedJob({
    get store() {
      return core.store;
    },
    get publicJob() {
      return services.publicJob;
    },
    get jobManifest() {
      return services.jobManifest;
    },
    get refsFor() {
      return services.refsFor;
    },
    get outputJob() {
      return services.outputJob;
    },
    get evidenceView() {
      return services.evidenceView;
    },
    get isExplicitBodyRead() {
      return services.isExplicitBodyRead;
    },
    get explicitBodyReadView() {
      return services.explicitBodyReadView;
    },
  });
}
