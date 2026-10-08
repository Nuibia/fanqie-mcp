import * as bodyModel from '../platform/short-native-body.js';
import { AppError } from '../errors.js';
import {
  type CaptureBodyToolInputOperation,
  type RawBodyToolSignalOperation,
} from './contracts/tool-input.js';

interface Dependencies {
  rawBodyToolSignal: RawBodyToolSignalOperation;
}

export function createCaptureBodyToolInput(deps: Dependencies): CaptureBodyToolInputOperation {
  function captureBodyToolInput(name: string, input: unknown): unknown {
    const dedicated = name === 'get_short_body_snapshot' || name === 'update_short_body';
    if (!dedicated) {
      if (deps.rawBodyToolSignal(input))
        throw new AppError(
          'invalid_input',
          'Native short body requires its dedicated isolated tool.',
          400,
        );
      return input;
    }
    try {
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
        Object.getOwnPropertySymbols(input).length
      )
        throw Error('Invalid body input');
      const descriptors = Object.getOwnPropertyDescriptors(input);
      const keys =
        name === 'get_short_body_snapshot'
          ? ['workId']
          : [
              'idempotencyKey',
              'target',
              'snapshotScope',
              'expectedSnapshotVersionHash',
              'hashBasis',
              'expectedState',
              'representation',
              'paragraphs',
              'trial',
              ...(Object.hasOwn(descriptors, 'comparisonPolicy') ? ['comparisonPolicy'] : []),
            ];
      if (
        Object.keys(descriptors).length !== keys.length ||
        keys.some(
          (key) => !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key]!, 'value'),
        )
      )
        throw Error('Invalid body descriptors');
      if (name === 'get_short_body_snapshot') {
        const workId = descriptors.workId!.value;
        if (typeof workId !== 'string' || !/^[1-9][0-9]{9,21}$/.test(workId))
          throw Error('Invalid body target');
        return { workId };
      }
      const idempotencyKey = descriptors.idempotencyKey!.value;
      if (
        typeof idempotencyKey !== 'string' ||
        idempotencyKey.length < 8 ||
        idempotencyKey.length > 128
      )
        throw Error('Invalid body key');
      const business = bodyModel.validateNativeShortBodyBusinessInput(
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
        'Native short body requires plain descriptor data and an exact isolated request.',
        400,
      );
    }
  }
  return captureBodyToolInput;
}
