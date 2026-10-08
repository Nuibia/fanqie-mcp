import { type CoreDependencies } from './core.js';
import { type ApplicationServices } from './services.js';
import { createCompleted } from './completed.js';
import { createWait } from './wait.js';
import { createManifestView } from './manifest-view.js';
import { createSnapshot } from './snapshot.js';
import { createCollect } from './collect.js';
import { createRefresh } from './refresh.js';
import { createEnqueueNativeShortMetadataRead } from './enqueue-native-short-metadata-read.js';
export function composeQuery(core: CoreDependencies, services: ApplicationServices): void {
  services.completed = createCompleted({
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
  services.wait = createWait({
    get store() {
      return core.store;
    },
    get config() {
      return core.config;
    },
    get completed() {
      return services.completed;
    },
  });
  services.manifestView = createManifestView({
    get publicJob() {
      return services.publicJob;
    },
    get refsFor() {
      return services.refsFor;
    },
    get evidenceView() {
      return services.evidenceView;
    },
  });
  services.snapshot = createSnapshot({
    get store() {
      return core.store;
    },
    get config() {
      return core.config;
    },
    get manifestView() {
      return services.manifestView;
    },
    get unavailableDirectoryProjection() {
      return services.unavailableDirectoryProjection;
    },
  });
  services.collect = createCollect({
    get store() {
      return core.store;
    },
    get requireLogin() {
      return services.requireLogin;
    },
    get readAccountPage() {
      return services.readAccountPage;
    },
    get readProfiles() {
      return core.readProfiles;
    },
    get collectedAccountDataset() {
      return services.collectedAccountDataset;
    },
  });
  services.refresh = createRefresh({
    get store() {
      return core.store;
    },
    get queue() {
      return core.queue;
    },
    get config() {
      return core.config;
    },
    get collect() {
      return services.collect;
    },
  });
  services.enqueueNativeShortMetadataRead = createEnqueueNativeShortMetadataRead({
    get queue() {
      return core.queue;
    },
    get explicitBodyReadKey() {
      return core.explicitBodyReadKey;
    },
    get config() {
      return core.config;
    },
    get nativeBoundAccount() {
      return services.nativeBoundAccount;
    },
    get store() {
      return core.store;
    },
    get browser() {
      return core.browser;
    },
    get bindIdentity() {
      return services.bindIdentity;
    },
    get login() {
      return core.login;
    },
    set login(value) {
      core.login = value;
    },
    get nativeProvenance() {
      return core.nativeProvenance;
    },
  });
}
