import { type CoreDependencies } from '../core.js';
import { type ApplicationServices } from '../services.js';
import { registerGetSavedSnapshotTool } from './get-saved-snapshot.js';
import { registerListSavedHistoryTool } from './list-saved-history.js';
import { registerListWorksTool } from './list-works.js';
import { registerGetWorkDetailTool } from './get-work-detail.js';
import { registerGetMetricsTool } from './get-metrics.js';
import { registerListChaptersTool } from './list-chapters.js';
export function registerGetSavedSnapshot(
  core: CoreDependencies,
  services: ApplicationServices,
): void {
  registerGetSavedSnapshotTool({
    get tool() {
      return services.tool;
    },
    get snapshot() {
      return services.snapshot;
    },
  });
  registerListSavedHistoryTool({
    get tool() {
      return services.tool;
    },
    get store() {
      return core.store;
    },
    get config() {
      return core.config;
    },
    get manifestView() {
      return services.manifestView;
    },
  });
  registerListWorksTool({
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
  registerGetWorkDetailTool({
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
  registerGetMetricsTool({
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
  registerListChaptersTool({
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
    get login() {
      return core.login;
    },
    set login(value) {
      core.login = value;
    },
    get bindIdentity() {
      return services.bindIdentity;
    },
    get browser() {
      return core.browser;
    },
  });
}
