import { validateNativeShortSubmissionWriteRequest } from '../short-native-submission.js';
import {
  type OwnedStopSignal,
  type NativeShortSubmissionServicePrepared,
  type NativeShortSubmissionApiOptions,
} from '../short-native-submission-api.js';

interface Ports {
  fields: (
    input: unknown,
    allowed: readonly string[],
    required?: readonly string[],
  ) => Record<string, unknown>;
  STOPPED: OwnedStopSignal;
  OWNER: RegExp;
  servicePrepared: (input: unknown) => NativeShortSubmissionServicePrepared;
}
export function createCaptureOptions(ports: Ports) {
  return function captureNativeShortSubmissionOptions(
    input: unknown,
  ): NativeShortSubmissionApiOptions | null {
    try {
      const base = [
        'mode',
        'expectedOwner',
        'deadline',
        'signal',
        'assertLease',
        'assertBorrowedActive',
        'onBeforePlatformRead',
        'onVerifiedAccount',
        'onQuarantine',
      ];
      const raw = ports.fields(
        input,
        [
          ...base,
          'businessRequest',
          'servicePrepared',
          'onBaseline',
          'onDurableIntent',
          'onBeforePlatformWrite',
          'onDurableAcknowledgement',
        ],
        base.filter((key) => key !== 'signal'),
      );
      const mode = raw.mode;
      if (!['prepare', 'submit', 'read'].includes(String(mode))) throw ports.STOPPED;
      const extra =
        mode === 'prepare'
          ? ['businessRequest']
          : mode === 'submit'
            ? [
                'businessRequest',
                'servicePrepared',
                'onBaseline',
                'onDurableIntent',
                'onBeforePlatformWrite',
                'onDurableAcknowledgement',
              ]
            : [];
      const value = ports.fields(
          input,
          [...base, ...extra],
          [...base, ...extra].filter((key) => key !== 'signal'),
        ),
        owner = ports.fields(value.expectedOwner, ['kind', 'id']);
      if (
        owner.kind !== 'account' ||
        typeof owner.id !== 'string' ||
        !ports.OWNER.test(owner.id) ||
        typeof value.deadline !== 'number' ||
        !Number.isFinite(value.deadline)
      )
        throw ports.STOPPED;
      if (value.signal !== undefined)
        Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!.call(value.signal);
      for (const key of [
        ...base.filter((k) => k.startsWith('assert') || k.startsWith('on')),
        ...extra.filter((k) => k.startsWith('on')),
      ])
        if (typeof value[key] !== 'function') throw ports.STOPPED;
      return {
        ...value,
        expectedOwner: { kind: 'account', id: owner.id },
        ...(mode !== 'read'
          ? { businessRequest: validateNativeShortSubmissionWriteRequest(value.businessRequest) }
          : {}),
        ...(mode === 'submit'
          ? { servicePrepared: ports.servicePrepared(value.servicePrepared) }
          : {}),
      } as unknown as NativeShortSubmissionApiOptions;
    } catch {
      return null;
    }
  };
}
