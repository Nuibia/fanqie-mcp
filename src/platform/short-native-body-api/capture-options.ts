import { validateNativeShortBodyWriteRequest } from '../short-native-body.js';

import { type OwnedStopSignal, type NativeShortBodyApiOptions } from '../short-native-body-api.js';

interface Ports {
  fields: (
    input: unknown,
    required: readonly string[],
    optional?: readonly string[],
  ) => Record<string, unknown>;
  configAccount: (input: unknown) => input is string;
  ACCOUNT: RegExp;
  WORK: RegExp;
  STOPPED: OwnedStopSignal;
  signalAborted: (signal: AbortSignal | undefined) => boolean;
}
export function createBodyOptions(ports: Ports) {
  return function captureOptions(input: unknown, workId: string): NativeShortBodyApiOptions {
    const value = ports.fields(
      input,
      [
        'accountId',
        'expectedOwner',
        'businessRequest',
        'deadline',
        'assertLease',
        'assertBorrowedActive',
        'onBeforePlatformRead',
        'onVerifiedAccount',
        'onQuarantine',
      ],
      ['signal', 'onStage'],
    );
    const owner = ports.fields(value.expectedOwner, ['kind', 'id']);
    if (
      !ports.configAccount(value.accountId) ||
      owner.kind !== 'account' ||
      typeof owner.id !== 'string' ||
      !ports.ACCOUNT.test(owner.id) ||
      !ports.WORK.test(workId) ||
      typeof value.deadline !== 'number' ||
      !Number.isFinite(value.deadline)
    )
      throw ports.STOPPED;
    for (const key of [
      'assertLease',
      'assertBorrowedActive',
      'onBeforePlatformRead',
      'onVerifiedAccount',
      'onQuarantine',
    ])
      if (typeof value[key] !== 'function') throw ports.STOPPED;
    if (
      (value.signal !== undefined && !(value.signal instanceof AbortSignal)) ||
      (value.onStage !== undefined && typeof value.onStage !== 'function')
    )
      throw ports.STOPPED;
    ports.signalAborted(value.signal as AbortSignal | undefined); // Validate the native internal slot without a caller getter.
    return {
      accountId: value.accountId,
      expectedOwner: { kind: 'account', id: owner.id },
      businessRequest: validateNativeShortBodyWriteRequest(value.businessRequest),
      deadline: value.deadline,
      signal: value.signal as AbortSignal | undefined,
      assertLease: value.assertLease as () => void,
      assertBorrowedActive: value.assertBorrowedActive as () => void,
      onBeforePlatformRead: value.onBeforePlatformRead as () => void,
      onVerifiedAccount: value.onVerifiedAccount as NativeShortBodyApiOptions['onVerifiedAccount'],
      onQuarantine: value.onQuarantine as () => void,
      onStage: value.onStage as NativeShortBodyApiOptions['onStage'],
    };
  };
}
