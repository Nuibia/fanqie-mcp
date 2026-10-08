import { type CoreDependencies } from './core.js';
import { type ApplicationServices } from './services.js';
import { createRejectBinding } from './reject-binding.js';
import { createPersistBinding } from './persist-binding.js';
import { createBindIdentity } from './bind-identity.js';
import { createCheckLogin } from './check-login.js';
import { createRequireLogin } from './require-login.js';
import { createReadAccountPage } from './read-account-page.js';
import { createCollectedAccountDataset } from './collected-account-dataset.js';
export function composeIdentity(core: CoreDependencies, services: ApplicationServices): void {
  services.rejectBinding = createRejectBinding({
    get store() {
      return core.store;
    },
    get login() {
      return core.login;
    },
    set login(value) {
      core.login = value;
    },
  });
  services.persistBinding = createPersistBinding({
    get store() {
      return core.store;
    },
    get bindingFile() {
      return core.bindingFile;
    },
    get bound() {
      return core.bound;
    },
    set bound(value) {
      core.bound = value;
    },
  });
  services.bindIdentity = createBindIdentity({
    get store() {
      return core.store;
    },
    get rejectBinding() {
      return services.rejectBinding;
    },
    get bound() {
      return core.bound;
    },
    set bound(value) {
      core.bound = value;
    },
    get persistBinding() {
      return services.persistBinding;
    },
    get config() {
      return core.config;
    },
  });
  services.checkLogin = createCheckLogin({
    get store() {
      return core.store;
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
  services.requireLogin = createRequireLogin({
    get store() {
      return core.store;
    },
    get checkLogin() {
      return services.checkLogin;
    },
  });
  services.readAccountPage = createReadAccountPage({
    get store() {
      return core.store;
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
  services.collectedAccountDataset = createCollectedAccountDataset({});
}
