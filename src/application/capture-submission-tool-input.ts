import * as submissionRuntime from '../platform/short-native-submission-runtime.js';
import { AppError } from '../errors.js';
import { type CaptureSubmissionToolInputOperation } from './contracts/tool-input.js';

interface Dependencies {}

export function createCaptureSubmissionToolInput(
  deps: Dependencies,
): CaptureSubmissionToolInputOperation {
  function captureSubmissionToolInput(name: string, input: unknown): unknown {
    const allowedTool = ['prepare_submission', 'submit_short_story'].includes(name);
    let signal = submissionRuntime.hasReservedNativeShortSubmissionSignal(input);
    try {
      if (input && typeof input === 'object') {
        const d = Object.getOwnPropertyDescriptors(input);
        signal ||= Object.hasOwn(d, 'useAi') || Object.hasOwn(d, 'activity');
        const proto = Object.getPrototypeOf(input);
        if (
          proto !== Object.prototype &&
          proto !== null &&
          proto !== Array.prototype &&
          submissionRuntime.hasReservedNativeShortSubmissionSignal(proto)
        )
          signal = true;
      }
      if (!signal) return input;
      if (!allowedTool) throw Error('Reserved submission mixed into another operation');
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
        Object.getOwnPropertySymbols(input).length
      )
        throw Error('Invalid submission');
      const keys = [
          'target',
          'snapshotScope',
          'hashBasis',
          'expectedSnapshotVersionHash',
          'expectedState',
          'useAi',
          ...(name === 'submit_short_story'
            ? ['idempotencyKey', 'preparationJobId', 'acceptPublicationTerms']
            : []),
        ],
        d = Object.getOwnPropertyDescriptors(input);
      if (
        Object.keys(d).length !== keys.length ||
        keys.some((k) => !d[k]?.enumerable || !Object.hasOwn(d[k]!, 'value'))
      )
        throw Error('Invalid submission descriptors');
      const captured = Object.fromEntries(keys.map((k) => [k, d[k]!.value]));
      if (name === 'prepare_submission')
        return submissionRuntime.captureNativeShortSubmissionBusinessInput(captured);
      const { idempotencyKey, ...business } = captured;
      if (
        typeof idempotencyKey !== 'string' ||
        idempotencyKey.length < 8 ||
        idempotencyKey.length > 128
      )
        throw Error('Invalid idempotency key');
      return {
        idempotencyKey,
        ...submissionRuntime.validateNativeShortSubmissionBusinessInput(business),
      };
    } catch {
      throw new AppError(
        'invalid_input',
        'Native short submission requires an exact isolated request, explicit useAi and current service preparation',
        400,
      );
    }
  }
  return captureSubmissionToolInput;
}
