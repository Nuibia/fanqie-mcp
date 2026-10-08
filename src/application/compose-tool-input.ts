import { type CoreDependencies } from './core.js';
import { type ApplicationServices } from './services.js';
import { createRequireEditorWritesEnabled } from './require-editor-writes-enabled.js';
import { createReceiveCover } from './receive-cover.js';
import { createCaptureSubmissionToolInput } from './capture-submission-tool-input.js';
import { createRawTrialToolSignal } from './raw-trial-tool-signal.js';
import { createCaptureTrialToolInput } from './capture-trial-tool-input.js';
import { createRawBodyToolSignal } from './raw-body-tool-signal.js';
import { createCaptureBodyToolInput } from './capture-body-tool-input.js';
import { createCaptureDirectoryToolInput } from './capture-directory-tool-input.js';
import { createTool } from './tool.js';
export function composeToolInput(core: CoreDependencies, services: ApplicationServices): void {
  services.requireEditorWritesEnabled = createRequireEditorWritesEnabled({
    get config() {
      return core.config;
    },
  });
  services.receiveCover = createReceiveCover({
    get store() {
      return core.store;
    },
    get config() {
      return core.config;
    },
  });
  services.captureSubmissionToolInput = createCaptureSubmissionToolInput({});
  services.rawTrialToolSignal = createRawTrialToolSignal({});
  services.captureTrialToolInput = createCaptureTrialToolInput({
    get rawTrialToolSignal() {
      return services.rawTrialToolSignal;
    },
  });
  services.rawBodyToolSignal = createRawBodyToolSignal({});
  services.captureBodyToolInput = createCaptureBodyToolInput({
    get rawBodyToolSignal() {
      return services.rawBodyToolSignal;
    },
  });
  services.captureDirectoryToolInput = createCaptureDirectoryToolInput({});
  services.tool = createTool({
    get tools() {
      return core.tools;
    },
    get store() {
      return core.store;
    },
    get genericCapture() {
      return services.genericCapture;
    },
    get captureTrialToolInput() {
      return services.captureTrialToolInput;
    },
    get captureDirectoryToolInput() {
      return services.captureDirectoryToolInput;
    },
    get captureBodyToolInput() {
      return services.captureBodyToolInput;
    },
    get captureSubmissionToolInput() {
      return services.captureSubmissionToolInput;
    },
  });
}
