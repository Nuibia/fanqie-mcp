import { validateNativeShortPreparedSubmission } from '../short-native-submission.js';
import {
  type OwnedStopSignal,
  type NativeShortSubmissionEvidenceRef,
  type NativeShortSubmissionServicePrepared,
} from '../short-native-submission-api.js';

interface Ports {
  fields: (
    input: unknown,
    allowed: readonly string[],
    required?: readonly string[],
  ) => Record<string, unknown>;
  UUID: RegExp;
  STOPPED: OwnedStopSignal;
  freeze: <T>(value: T) => T;
  ref: (input: unknown) => NativeShortSubmissionEvidenceRef;
}
export function createServicePrepared(ports: Ports) {
  return function servicePrepared(input: unknown): NativeShortSubmissionServicePrepared {
    const p = ports.fields(input, ['preparationJobId', 'preparationEvidence', 'prepared']);
    if (typeof p.preparationJobId !== 'string' || !ports.UUID.test(p.preparationJobId))
      throw ports.STOPPED;
    return ports.freeze({
      preparationJobId: p.preparationJobId,
      preparationEvidence: ports.ref(p.preparationEvidence),
      prepared: validateNativeShortPreparedSubmission(p.prepared),
    });
  };
}
