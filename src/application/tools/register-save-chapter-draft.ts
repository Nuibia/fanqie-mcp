import { type CoreDependencies } from '../core.js';
import { type ApplicationServices } from '../services.js';
import { registerSaveChapterDraftTool } from './save-chapter-draft.js';
import { registerPrepareSubmissionTool } from './prepare-submission.js';
import { registerSubmissionTool } from './submission.js';
export function registerSaveChapterDraft(
  core: CoreDependencies,
  services: ApplicationServices,
): void {
  registerSaveChapterDraftTool({
    get tool() {
      return services.tool;
    },
    get executeWrite() {
      return services.executeWrite;
    },
  });
  registerPrepareSubmissionTool({
    get tool() {
      return services.tool;
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
    get nativeBoundAccount() {
      return services.nativeBoundAccount;
    },
    get store() {
      return core.store;
    },
    get browser() {
      return core.browser;
    },
    get submissionOptions() {
      return services.submissionOptions;
    },
    get requireEditorWritesEnabled() {
      return services.requireEditorWritesEnabled;
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
    get writeProfiles() {
      return core.writeProfiles;
    },
    get bound() {
      return core.bound;
    },
    set bound(value) {
      core.bound = value;
    },
  });
  registerSubmissionTool({
    get tool() {
      return services.tool;
    },
    get submissionSchema() {
      return core.submissionSchema;
    },
    get executeNativeShortSubmissionWrite() {
      return services.executeNativeShortSubmissionWrite;
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
    get executeWrite() {
      return services.executeWrite;
    },
  });
}
