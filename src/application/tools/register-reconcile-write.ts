import { type CoreDependencies } from '../core.js';
import { type ApplicationServices } from '../services.js';
import { registerReconcileWriteTool } from './reconcile-write.js';
import { registerCreateDraftTool } from './create-draft.js';
import { registerResumeCreateDraftTool } from './resume-create-draft.js';
import { registerRepairCreatedDraftTool } from './repair-created-draft.js';
import { registerUpdateDraftTool } from './update-draft.js';
import { registerUpdateWorkMetadataTool } from './update-work-metadata.js';
export function registerReconcileWrite(
  core: CoreDependencies,
  services: ApplicationServices,
): void {
  registerReconcileWriteTool({
    get tool() {
      return services.tool;
    },
    get store() {
      return core.store;
    },
    get config() {
      return core.config;
    },
    get requireEditorWritesEnabled() {
      return services.requireEditorWritesEnabled;
    },
    get refsFor() {
      return services.refsFor;
    },
    get queue() {
      return core.queue;
    },
    get browser() {
      return core.browser;
    },
    get nativeProvenance() {
      return core.nativeProvenance;
    },
    get nativeBoundAccount() {
      return services.nativeBoundAccount;
    },
    get completed() {
      return services.completed;
    },
    get submissionOptions() {
      return services.submissionOptions;
    },
    get bodyExecutorEligible() {
      return core.bodyExecutorEligible;
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
    get reconcileNativeCompensation() {
      return services.reconcileNativeCompensation;
    },
    get reconcileNativeShortMetadata() {
      return services.reconcileNativeShortMetadata;
    },
    get reconcileBookMetadata() {
      return services.reconcileBookMetadata;
    },
    get requireLogin() {
      return services.requireLogin;
    },
    get modernShortProfile() {
      return services.modernShortProfile;
    },
    get readAccountPage() {
      return services.readAccountPage;
    },
    get platformAccount() {
      return services.platformAccount;
    },
    get writeProfiles() {
      return core.writeProfiles;
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
    get persistGenericShortObservation() {
      return services.persistGenericShortObservation;
    },
    get advanceGenericShortStatus() {
      return services.advanceGenericShortStatus;
    },
    get genericShortRun() {
      return services.genericShortRun;
    },
    get runtimeTarget() {
      return services.runtimeTarget;
    },
    get retainGenericShortContext() {
      return services.retainGenericShortContext;
    },
  });
  registerCreateDraftTool({
    get tool() {
      return services.tool;
    },
    get executeWrite() {
      return services.executeWrite;
    },
  });
  registerResumeCreateDraftTool({
    get tool() {
      return services.tool;
    },
    get resumeCreateDraft() {
      return services.resumeCreateDraft;
    },
  });
  registerRepairCreatedDraftTool({
    get tool() {
      return services.tool;
    },
    get repairCreatedDraft() {
      return services.repairCreatedDraft;
    },
  });
  registerUpdateDraftTool({
    get tool() {
      return services.tool;
    },
    get executeWrite() {
      return services.executeWrite;
    },
  });
  registerUpdateWorkMetadataTool({
    get tool() {
      return services.tool;
    },
    get config() {
      return core.config;
    },
    get executeNativeShortTrialWrite() {
      return services.executeNativeShortTrialWrite;
    },
    get executeNativeShortCoverWrite() {
      return services.executeNativeShortCoverWrite;
    },
    get executeNativeShortMetadataWrite() {
      return services.executeNativeShortMetadataWrite;
    },
    get executeBookMetadataWrite() {
      return services.executeBookMetadataWrite;
    },
    get executeWrite() {
      return services.executeWrite;
    },
  });
}
