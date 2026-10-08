import { type CoreDependencies } from '../core.js';
import { type ApplicationServices } from '../services.js';
import { registerUploadCoverTool } from './upload-cover.js';
import { registerGetServiceStatusTool } from './get-service-status.js';
import { registerGetCapabilitiesTool } from './get-capabilities.js';
import { registerDiagnoseCurrentLoginTool } from './diagnose-current-login.js';
import { registerDiagnoseShortMetadataSchemaTool } from './diagnose-short-metadata-schema.js';
import { registerDiagnoseShortMetadataApiSchemaTool } from './diagnose-short-metadata-api-schema.js';
export function registerUploadCover(core: CoreDependencies, services: ApplicationServices): void {
  registerUploadCoverTool({
    get tool() {
      return services.tool;
    },
    get receiveCover() {
      return services.receiveCover;
    },
  });
  registerGetServiceStatusTool({
    get tool() {
      return services.tool;
    },
    get status() {
      return services.status;
    },
  });
  registerGetCapabilitiesTool({
    get tool() {
      return services.tool;
    },
    get capabilities() {
      return services.capabilities;
    },
  });
  registerDiagnoseCurrentLoginTool({
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
    get browser() {
      return core.browser;
    },
  });
  registerDiagnoseShortMetadataSchemaTool({
    get tool() {
      return services.tool;
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
    get bound() {
      return core.bound;
    },
    set bound(value) {
      core.bound = value;
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
  });
  registerDiagnoseShortMetadataApiSchemaTool({
    get tool() {
      return services.tool;
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
    get bound() {
      return core.bound;
    },
    set bound(value) {
      core.bound = value;
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
  });
}
