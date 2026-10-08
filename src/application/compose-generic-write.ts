import { type CoreDependencies } from './core.js';
import { type ApplicationServices } from './services.js';
import { createGenericCapture } from './generic-capture.js';
import { createModernShortProfile } from './modern-short-profile.js';
import { createBeginGenericShortStatus } from './begin-generic-short-status.js';
import { createAdvanceGenericShortStatus } from './advance-generic-short-status.js';
import { createBindGenericShortTarget } from './bind-generic-short-target.js';
import { createPersistGenericShortObservation } from './persist-generic-short-observation.js';
import { createGenericCanonicalResult } from './generic-canonical-result.js';
import { createGenericShortRun } from './generic-short-run.js';
import { createRetainGenericShortContext } from './retain-generic-short-context.js';
import { createGenericBusinessExecution } from './generic-business-execution.js';
export function composeGenericWrite(core: CoreDependencies, services: ApplicationServices): void {
  services.genericCapture = createGenericCapture({});
  services.modernShortProfile = createModernShortProfile({
    get writeProfiles() {
      return core.writeProfiles;
    },
  });
  services.beginGenericShortStatus = createBeginGenericShortStatus({
    get store() {
      return core.store;
    },
    get config() {
      return core.config;
    },
    get writeProfiles() {
      return core.writeProfiles;
    },
    get modernShortProfile() {
      return services.modernShortProfile;
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
    get genericCapture() {
      return services.genericCapture;
    },
    get nativeProvenance() {
      return core.nativeProvenance;
    },
    get genericShortContexts() {
      return core.genericShortContexts;
    },
  });
  services.advanceGenericShortStatus = createAdvanceGenericShortStatus({
    get genericShortContexts() {
      return core.genericShortContexts;
    },
    get genericCapture() {
      return services.genericCapture;
    },
  });
  services.bindGenericShortTarget = createBindGenericShortTarget({
    get genericShortContexts() {
      return core.genericShortContexts;
    },
    get genericCapture() {
      return services.genericCapture;
    },
  });
  services.persistGenericShortObservation = createPersistGenericShortObservation({
    get genericShortContexts() {
      return core.genericShortContexts;
    },
    get runtimeTarget() {
      return services.runtimeTarget;
    },
    get advanceGenericShortStatus() {
      return services.advanceGenericShortStatus;
    },
    get genericCapture() {
      return services.genericCapture;
    },
    get store() {
      return core.store;
    },
  });
  services.genericCanonicalResult = createGenericCanonicalResult({
    get genericShortContexts() {
      return core.genericShortContexts;
    },
    get genericCapture() {
      return services.genericCapture;
    },
    get store() {
      return core.store;
    },
  });
  services.genericShortRun = createGenericShortRun({
    get beginGenericShortStatus() {
      return services.beginGenericShortStatus;
    },
    get genericShortContexts() {
      return core.genericShortContexts;
    },
    get advanceGenericShortStatus() {
      return services.advanceGenericShortStatus;
    },
    get store() {
      return core.store;
    },
  });
  services.retainGenericShortContext = createRetainGenericShortContext({
    get genericShortContexts() {
      return core.genericShortContexts;
    },
  });
  services.genericBusinessExecution = createGenericBusinessExecution({
    get store() {
      return core.store;
    },
    get runtimeTarget() {
      return services.runtimeTarget;
    },
  });
}
