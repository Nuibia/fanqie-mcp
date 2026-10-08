import { type CoreDependencies } from './core.js';
import { type ApplicationServices } from './services.js';
import { createResumeCreateDraft } from './resume-create-draft.js';
import { createRepairCreatedDraft } from './repair-created-draft.js';
export function composeCreationRecovery(
  core: CoreDependencies,
  services: ApplicationServices,
): void {
  services.resumeCreateDraft = createResumeCreateDraft({
    get store() {
      return core.store;
    },
    get requireEditorWritesEnabled() {
      return services.requireEditorWritesEnabled;
    },
    get config() {
      return core.config;
    },
    get refsFor() {
      return services.refsFor;
    },
    get queue() {
      return core.queue;
    },
    get requireLogin() {
      return services.requireLogin;
    },
    get writeOptions() {
      return services.writeOptions;
    },
    get browser() {
      return core.browser;
    },
    get platformAccount() {
      return services.platformAccount;
    },
    get genericShortContexts() {
      return core.genericShortContexts;
    },
    get persistGenericShortObservation() {
      return services.persistGenericShortObservation;
    },
    get runtimeTarget() {
      return services.runtimeTarget;
    },
    get genericCanonicalResult() {
      return services.genericCanonicalResult;
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
    get wait() {
      return services.wait;
    },
    get retainGenericShortContext() {
      return services.retainGenericShortContext;
    },
    get outputJob() {
      return services.outputJob;
    },
    get completed() {
      return services.completed;
    },
  });
  services.repairCreatedDraft = createRepairCreatedDraft({
    get store() {
      return core.store;
    },
    get requireEditorWritesEnabled() {
      return services.requireEditorWritesEnabled;
    },
    get config() {
      return core.config;
    },
    get refsFor() {
      return services.refsFor;
    },
    get queue() {
      return core.queue;
    },
    get requireLogin() {
      return services.requireLogin;
    },
    get writeOptions() {
      return services.writeOptions;
    },
    get browser() {
      return core.browser;
    },
    get platformAccount() {
      return services.platformAccount;
    },
    get genericShortContexts() {
      return core.genericShortContexts;
    },
    get persistGenericShortObservation() {
      return services.persistGenericShortObservation;
    },
    get runtimeTarget() {
      return services.runtimeTarget;
    },
    get bindGenericShortTarget() {
      return services.bindGenericShortTarget;
    },
    get advanceGenericShortStatus() {
      return services.advanceGenericShortStatus;
    },
    get genericCanonicalResult() {
      return services.genericCanonicalResult;
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
    get wait() {
      return services.wait;
    },
    get retainGenericShortContext() {
      return services.retainGenericShortContext;
    },
    get outputJob() {
      return services.outputJob;
    },
    get completed() {
      return services.completed;
    },
  });
}
