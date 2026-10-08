import { type CoreDependencies } from './core.js';
import { type ApplicationServices } from './services.js';
import { createNativeAuditBeforeRead } from './native-audit-before-read.js';
import { createReconcileNativeShortMetadata } from './reconcile-native-short-metadata.js';
import { createReconcileNativeCompensation } from './reconcile-native-compensation.js';
import { createReconcileBookMetadata } from './reconcile-book-metadata.js';
export function composeReconciliation(core: CoreDependencies, services: ApplicationServices): void {
  services.nativeAuditBeforeRead = createNativeAuditBeforeRead({
    get nativeOriginalContext() {
      return services.nativeOriginalContext;
    },
    get nativeClosureContext() {
      return services.nativeClosureContext;
    },
    get store() {
      return core.store;
    },
    get config() {
      return core.config;
    },
    get refsFor() {
      return services.refsFor;
    },
    get jobManifest() {
      return services.jobManifest;
    },
  });
  services.reconcileNativeShortMetadata = createReconcileNativeShortMetadata({
    get nativeAuditBeforeRead() {
      return services.nativeAuditBeforeRead;
    },
    get nativeBoundAccount() {
      return services.nativeBoundAccount;
    },
    get browser() {
      return core.browser;
    },
    get queue() {
      return core.queue;
    },
    get config() {
      return core.config;
    },
    get store() {
      return core.store;
    },
    get refsFor() {
      return services.refsFor;
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
    get completed() {
      return services.completed;
    },
    get nativeReconciliationContext() {
      return services.nativeReconciliationContext;
    },
    get jobManifest() {
      return services.jobManifest;
    },
  });
  services.reconcileNativeCompensation = createReconcileNativeCompensation({
    get nativeProvenance() {
      return core.nativeProvenance;
    },
    get nativeBoundAccount() {
      return services.nativeBoundAccount;
    },
    get browser() {
      return core.browser;
    },
    get queue() {
      return core.queue;
    },
    get config() {
      return core.config;
    },
    get store() {
      return core.store;
    },
    get refsFor() {
      return services.refsFor;
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
    get completed() {
      return services.completed;
    },
    get jobManifest() {
      return services.jobManifest;
    },
  });
  services.reconcileBookMetadata = createReconcileBookMetadata({
    get refsFor() {
      return services.refsFor;
    },
    get store() {
      return core.store;
    },
    get queue() {
      return core.queue;
    },
    get config() {
      return core.config;
    },
    get requireLogin() {
      return services.requireLogin;
    },
    get readAccountPage() {
      return services.readAccountPage;
    },
    get platformAccount() {
      return services.platformAccount;
    },
    get bookWriteOptions() {
      return services.bookWriteOptions;
    },
    get completed() {
      return services.completed;
    },
  });
}
