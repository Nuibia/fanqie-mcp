import { type CoreDependencies } from '../core.js';
import { type ApplicationServices } from '../services.js';
import { registerGetShortMetadataSnapshotTool } from './get-short-metadata-snapshot.js';
import { registerGetShortBodySnapshotTool } from './get-short-body-snapshot.js';
import { registerUpdateShortBodyTool } from './update-short-body.js';
import { registerListShortDraftsTool } from './list-short-drafts.js';
import { registerGetJobTool } from './get-job.js';
import { registerCancelJobTool } from './cancel-job.js';
export function registerGetShortMetadataSnapshot(
  core: CoreDependencies,
  services: ApplicationServices,
): void {
  registerGetShortMetadataSnapshotTool({
    get tool() {
      return services.tool;
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
    get completed() {
      return services.completed;
    },
    get enqueueNativeShortMetadataRead() {
      return services.enqueueNativeShortMetadataRead;
    },
  });
  registerGetShortBodySnapshotTool({
    get tool() {
      return services.tool;
    },
    get enqueueNativeShortMetadataRead() {
      return services.enqueueNativeShortMetadataRead;
    },
    get completed() {
      return services.completed;
    },
    get store() {
      return core.store;
    },
    get config() {
      return core.config;
    },
  });
  registerUpdateShortBodyTool({
    get tool() {
      return services.tool;
    },
    get bodyTrialSchema() {
      return core.bodyTrialSchema;
    },
    get executeNativeShortBodyWrite() {
      return services.executeNativeShortBodyWrite;
    },
  });
  registerListShortDraftsTool({
    get tool() {
      return services.tool;
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
    get bindIdentity() {
      return services.bindIdentity;
    },
    get login() {
      return core.login;
    },
    set login(value) {
      core.login = value;
    },
    get directoryApplicationOrigin() {
      return core.directoryApplicationOrigin;
    },
    get completed() {
      return services.completed;
    },
  });
  registerGetJobTool({
    get tool() {
      return services.tool;
    },
    get publicJob() {
      return services.publicJob;
    },
    get config() {
      return core.config;
    },
    get completed() {
      return services.completed;
    },
  });
  registerCancelJobTool({
    get tool() {
      return services.tool;
    },
    get publicJob() {
      return services.publicJob;
    },
    get config() {
      return core.config;
    },
    get completed() {
      return services.completed;
    },
    get queue() {
      return core.queue;
    },
  });
}
