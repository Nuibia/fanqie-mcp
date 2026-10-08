import { type CoreDependencies } from '../core.js';
import { type ApplicationServices } from '../services.js';
import { registerGetChapterTool } from './get-chapter.js';
import { registerListChapterDraftsTool } from './list-chapter-drafts.js';
import { registerListActivitiesTool } from './list-activities.js';
import { registerGetWriterClassCatalogTool } from './get-writer-class-catalog.js';
import { registerGetWriterArticleTool } from './get-writer-article.js';
import { registerGetEditableSnapshotTool } from './get-editable-snapshot.js';
export function registerGetChapter(core: CoreDependencies, services: ApplicationServices): void {
  registerGetChapterTool({
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
    get requireLogin() {
      return services.requireLogin;
    },
    get bound() {
      return core.bound;
    },
    set bound(value) {
      core.bound = value;
    },
    get browser() {
      return core.browser;
    },
    get login() {
      return core.login;
    },
    set login(value) {
      core.login = value;
    },
    get bindIdentity() {
      return services.bindIdentity;
    },
  });
  registerListChapterDraftsTool({
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
    get requireLogin() {
      return services.requireLogin;
    },
    get bound() {
      return core.bound;
    },
    set bound(value) {
      core.bound = value;
    },
    get browser() {
      return core.browser;
    },
    get login() {
      return core.login;
    },
    set login(value) {
      core.login = value;
    },
    get bindIdentity() {
      return services.bindIdentity;
    },
  });
  registerListActivitiesTool({
    get tool() {
      return services.tool;
    },
    get wait() {
      return services.wait;
    },
    get refresh() {
      return services.refresh;
    },
  });
  registerGetWriterClassCatalogTool({
    get tool() {
      return services.tool;
    },
    get wait() {
      return services.wait;
    },
    get refresh() {
      return services.refresh;
    },
  });
  registerGetWriterArticleTool({
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
  });
  registerGetEditableSnapshotTool({
    get tool() {
      return services.tool;
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
    get readAccountPage() {
      return services.readAccountPage;
    },
    get platformAccount() {
      return services.platformAccount;
    },
    get bookWriteOptions() {
      return services.bookWriteOptions;
    },
    get retainGenericShortContext() {
      return services.retainGenericShortContext;
    },
    get writeProfiles() {
      return core.writeProfiles;
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
    get persistGenericShortObservation() {
      return services.persistGenericShortObservation;
    },
    get advanceGenericShortStatus() {
      return services.advanceGenericShortStatus;
    },
    get modernShortProfile() {
      return services.modernShortProfile;
    },
    get genericShortRun() {
      return services.genericShortRun;
    },
    get runtimeTarget() {
      return services.runtimeTarget;
    },
    get store() {
      return core.store;
    },
  });
}
