import {
  type OwnedStopSignal,
  type NativeShortSubmissionEvidenceRef,
} from '../short-native-submission-api.js';

interface Ports {
  fields: (
    input: unknown,
    allowed: readonly string[],
    required?: readonly string[],
  ) => Record<string, unknown>;
  UUID: RegExp;
  HASH: RegExp;
  time: (value: unknown) => value is string;
  STOPPED: OwnedStopSignal;
  freeze: <T>(value: T) => T;
}
export function createReference(ports: Ports) {
  return function ref(input: unknown): NativeShortSubmissionEvidenceRef {
    const r = ports.fields(input, ['id', 'sha256', 'capturedAt']);
    if (
      typeof r.id !== 'string' ||
      !ports.UUID.test(r.id) ||
      typeof r.sha256 !== 'string' ||
      !ports.HASH.test(r.sha256) ||
      !ports.time(r.capturedAt)
    )
      throw ports.STOPPED;
    return ports.freeze(r) as unknown as NativeShortSubmissionEvidenceRef;
  };
}
