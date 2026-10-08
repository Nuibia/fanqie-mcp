import { type CoreDependencies } from './core.js';
import { type ApplicationServices } from './services.js';
import { createNativeBoundAccount } from './native-bound-account.js';
import { createCapabilities } from './capabilities.js';
import { createStatus } from './status.js';
import { createPlatformAccount } from './platform-account.js';
export function composeCapabilities(core: CoreDependencies, services: ApplicationServices): void {
  services.nativeBoundAccount = createNativeBoundAccount({
    get bound() {
      return core.bound;
    },
    set bound(value) {
      core.bound = value;
    },
    get config() {
      return core.config;
    },
  });
  services.capabilities = createCapabilities({
    get store() {
      return core.store;
    },
    get config() {
      return core.config;
    },
    get evidenceView() {
      return services.evidenceView;
    },
    get publicJob() {
      return services.publicJob;
    },
    get nativeBoundAccount() {
      return services.nativeBoundAccount;
    },
    get browser() {
      return core.browser;
    },
    get jobManifest() {
      return services.jobManifest;
    },
    get refsFor() {
      return services.refsFor;
    },
    get isExplicitBodyRead() {
      return services.isExplicitBodyRead;
    },
    get bodyExecutorEligible() {
      return core.bodyExecutorEligible;
    },
    get writeProfiles() {
      return core.writeProfiles;
    },
  });
  services.status = createStatus({
    get store() {
      return core.store;
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
  });
  services.platformAccount = createPlatformAccount({
    get bound() {
      return core.bound;
    },
    set bound(value) {
      core.bound = value;
    },
  });
}
