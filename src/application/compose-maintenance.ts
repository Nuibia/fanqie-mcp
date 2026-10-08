import { type CoreDependencies } from './core.js';
import { type ApplicationServices } from './services.js';
import { createWriteOptions } from './write-options.js';
import { createRuntimeTarget } from './runtime-target.js';
import { createExecuteWrite } from './execute-write.js';
import { createExecuteNativeShortBodyWrite } from './execute-native-short-body-write.js';
import { createSubmissionOptions } from './submission-options.js';
import { createExecuteNativeShortSubmissionWrite } from './execute-native-short-submission-write.js';
import { createExecuteNativeShortTrialWrite } from './execute-native-short-trial-write.js';
import { createExecuteNativeShortCoverWrite } from './execute-native-short-cover-write.js';
import { createExecuteNativeShortMetadataWrite } from './execute-native-short-metadata-write.js';
import { createBookWriteOptions } from './book-write-options.js';
import { createExecuteBookMetadataWrite } from './execute-book-metadata-write.js';
export function composeMaintenance(core: CoreDependencies, services: ApplicationServices): void {
  services.writeOptions = createWriteOptions({
    get writeProfiles() {
      return core.writeProfiles;
    },
    get config() {
      return core.config;
    },
    get browser() {
      return core.browser;
    },
    get bound() {
      return core.bound;
    },
    set bound(value) {
      core.bound = value;
    },
    get genericShortContexts() {
      return core.genericShortContexts;
    },
    get genericCapture() {
      return services.genericCapture;
    },
    get persistGenericShortObservation() {
      return services.persistGenericShortObservation;
    },
    get runtimeTarget() {
      return services.runtimeTarget;
    },
    get advanceGenericShortStatus() {
      return services.advanceGenericShortStatus;
    },
    get bindGenericShortTarget() {
      return services.bindGenericShortTarget;
    },
  });
  services.runtimeTarget = createRuntimeTarget({});
  services.executeWrite = createExecuteWrite({
    get store() {
      return core.store;
    },
    get config() {
      return core.config;
    },
    get queue() {
      return core.queue;
    },
    get requireLogin() {
      return services.requireLogin;
    },
    get platformAccount() {
      return services.platformAccount;
    },
    get browser() {
      return core.browser;
    },
    get writeOptions() {
      return services.writeOptions;
    },
    get genericCanonicalResult() {
      return services.genericCanonicalResult;
    },
    get genericShortContexts() {
      return core.genericShortContexts;
    },
    get advanceGenericShortStatus() {
      return services.advanceGenericShortStatus;
    },
    get genericCapture() {
      return services.genericCapture;
    },
    get modernShortProfile() {
      return services.modernShortProfile;
    },
    get genericShortRun() {
      return services.genericShortRun;
    },
    get genericBusinessExecution() {
      return services.genericBusinessExecution;
    },
    get wait() {
      return services.wait;
    },
    get retainGenericShortContext() {
      return services.retainGenericShortContext;
    },
  });
  services.executeNativeShortBodyWrite = createExecuteNativeShortBodyWrite({
    get store() {
      return core.store;
    },
    get config() {
      return core.config;
    },
    get bodyExecutorEligible() {
      return core.bodyExecutorEligible;
    },
    get wait() {
      return services.wait;
    },
    get queue() {
      return core.queue;
    },
    get browser() {
      return core.browser;
    },
    get nativeBoundAccount() {
      return services.nativeBoundAccount;
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
  });
  services.submissionOptions = createSubmissionOptions({
    get config() {
      return core.config;
    },
    get nativeProvenance() {
      return core.nativeProvenance;
    },
    get nativeBoundAccount() {
      return services.nativeBoundAccount;
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
  });
  services.executeNativeShortSubmissionWrite = createExecuteNativeShortSubmissionWrite({
    get store() {
      return core.store;
    },
    get config() {
      return core.config;
    },
    get wait() {
      return services.wait;
    },
    get queue() {
      return core.queue;
    },
    get nativeBoundAccount() {
      return services.nativeBoundAccount;
    },
    get browser() {
      return core.browser;
    },
    get submissionOptions() {
      return services.submissionOptions;
    },
  });
  services.executeNativeShortTrialWrite = createExecuteNativeShortTrialWrite({
    get store() {
      return core.store;
    },
    get config() {
      return core.config;
    },
    get wait() {
      return services.wait;
    },
    get queue() {
      return core.queue;
    },
    get nativeBoundAccount() {
      return services.nativeBoundAccount;
    },
    get browser() {
      return core.browser;
    },
    get nativeProvenance() {
      return core.nativeProvenance;
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
  });
  services.executeNativeShortCoverWrite = createExecuteNativeShortCoverWrite({
    get store() {
      return core.store;
    },
    get config() {
      return core.config;
    },
    get wait() {
      return services.wait;
    },
    get queue() {
      return core.queue;
    },
    get nativeBoundAccount() {
      return services.nativeBoundAccount;
    },
    get browser() {
      return core.browser;
    },
    get nativeProvenance() {
      return core.nativeProvenance;
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
  });
  services.executeNativeShortMetadataWrite = createExecuteNativeShortMetadataWrite({
    get store() {
      return core.store;
    },
    get config() {
      return core.config;
    },
    get wait() {
      return services.wait;
    },
    get queue() {
      return core.queue;
    },
    get nativeBoundAccount() {
      return services.nativeBoundAccount;
    },
    get browser() {
      return core.browser;
    },
    get nativeProvenance() {
      return core.nativeProvenance;
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
  });
  services.bookWriteOptions = createBookWriteOptions({
    get writeProfiles() {
      return core.writeProfiles;
    },
    get config() {
      return core.config;
    },
    get browser() {
      return core.browser;
    },
    get runtimeTarget() {
      return services.runtimeTarget;
    },
  });
  services.executeBookMetadataWrite = createExecuteBookMetadataWrite({
    get store() {
      return core.store;
    },
    get requireEditorWritesEnabled() {
      return services.requireEditorWritesEnabled;
    },
    get wait() {
      return services.wait;
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
    get platformAccount() {
      return services.platformAccount;
    },
    get browser() {
      return core.browser;
    },
    get bookWriteOptions() {
      return services.bookWriteOptions;
    },
  });
}
