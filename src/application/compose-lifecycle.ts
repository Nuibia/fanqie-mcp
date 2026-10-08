import { type CoreDependencies } from './core.js';
import { type ApplicationServices } from './services.js';
import { createCall } from './call.js';
import { createAbortForLeaseLoss } from './abort-for-lease-loss.js';
import { createCloseOwned } from './close-owned.js';
export function composeLifecycle(core: CoreDependencies, services: ApplicationServices): void {
  services.call = createCall({
    get store() {
      return core.store;
    },
    get tools() {
      return core.tools;
    },
  });
  services.abortForLeaseLoss = createAbortForLeaseLoss({
    get store() {
      return core.store;
    },
    get leaseLossShutdown() {
      return core.leaseLossShutdown;
    },
    set leaseLossShutdown(value) {
      core.leaseLossShutdown = value;
    },
    get queue() {
      return core.queue;
    },
  });
  services.closeOwned = createCloseOwned({
    get store() {
      return core.store;
    },
    get abortForLeaseLoss() {
      return services.abortForLeaseLoss;
    },
    get closing() {
      return core.closing;
    },
    set closing(value) {
      core.closing = value;
    },
    get queue() {
      return core.queue;
    },
    get leaseLossShutdown() {
      return core.leaseLossShutdown;
    },
    set leaseLossShutdown(value) {
      core.leaseLossShutdown = value;
    },
    get browser() {
      return core.browser;
    },
  });
}
