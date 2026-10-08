import * as trialRuntime from '../platform/short-native-trial-runtime.js';
import { AppError } from '../errors.js';
import {
  type CaptureTrialToolInputOperation,
  type RawTrialToolSignalOperation,
} from './contracts/tool-input.js';

interface Dependencies {
  rawTrialToolSignal: RawTrialToolSignalOperation;
}

export function createCaptureTrialToolInput(deps: Dependencies): CaptureTrialToolInputOperation {
  /** The schema receives only a captured plain trial value. Zod must not erase
   * symbols, prototypes or non-enumerable fields before the trial gate sees them. */
  function captureTrialToolInput(name: string, input: unknown): unknown {
    if (
      !['update_work_metadata', 'get_short_metadata_snapshot'].includes(name) ||
      !deps.rawTrialToolSignal(input)
    )
      return input;
    try {
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
        Object.getOwnPropertySymbols(input).length
      )
        throw new Error('Invalid trial data');
      const descriptors = Object.getOwnPropertyDescriptors(input);
      const keys =
        name === 'update_work_metadata'
          ? [
              'idempotencyKey',
              'target',
              'snapshotScope',
              'hashBasis',
              'expectedSnapshotVersionHash',
              'expectedState',
              'metadata',
            ]
          : ['workId', 'snapshotScope'];
      if (
        Object.keys(descriptors).length !== keys.length ||
        keys.some(
          (key) => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key]!, 'value'),
        )
      )
        throw new Error('Invalid trial descriptors');
      if (name === 'get_short_metadata_snapshot') {
        const workId = descriptors.workId!.value,
          snapshotScope = descriptors.snapshotScope!.value;
        if (
          typeof workId !== 'string' ||
          typeof snapshotScope !== 'string' ||
          snapshotScope !== 'short-native-trial/v1'
        )
          throw new Error('Invalid trial read');
        return { workId, snapshotScope };
      }
      const idempotencyKey = descriptors.idempotencyKey!.value;
      if (
        typeof idempotencyKey !== 'string' ||
        idempotencyKey.length < 8 ||
        idempotencyKey.length > 128
      )
        throw new Error('Invalid trial key');
      const business = trialRuntime.validateNativeShortTrialBusinessInput(
        Object.fromEntries(
          keys
            .filter((key) => key !== 'idempotencyKey')
            .map((key) => [key, descriptors[key]!.value]),
        ),
      );
      return { idempotencyKey, ...business };
    } catch {
      throw new AppError(
        'invalid_input',
        'Native short trial requires plain descriptor data and an exact isolated request',
        400,
      );
    }
  }
  return captureTrialToolInput;
}
