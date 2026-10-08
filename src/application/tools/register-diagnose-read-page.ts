import { type CoreDependencies } from '../core.js';
import { type ApplicationServices } from '../services.js';
import { registerDiagnoseReadPageTool } from './diagnose-read-page.js';
import { registerDiagnoseEditorTool } from './diagnose-editor.js';
import { registerCheckLoginStatusTool } from './check-login-status.js';
import { registerGetLoginQrcodeTool } from './get-login-qrcode.js';
import { registerStartLoginTool } from './start-login.js';
import { registerRefreshAccountTool } from './refresh-account.js';
export function registerDiagnoseReadPage(
  core: CoreDependencies,
  services: ApplicationServices,
): void {
  registerDiagnoseReadPageTool({
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
    get browser() {
      return core.browser;
    },
  });
  registerDiagnoseEditorTool({
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
    get bound() {
      return core.bound;
    },
    set bound(value) {
      core.bound = value;
    },
    get writeProfiles() {
      return core.writeProfiles;
    },
    get browser() {
      return core.browser;
    },
  });
  registerCheckLoginStatusTool({
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
    get checkLogin() {
      return services.checkLogin;
    },
  });
  registerGetLoginQrcodeTool({
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
  registerStartLoginTool({
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
    get login() {
      return core.login;
    },
    set login(value) {
      core.login = value;
    },
    get browser() {
      return core.browser;
    },
    get bindIdentity() {
      return services.bindIdentity;
    },
  });
  registerRefreshAccountTool({
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
}
