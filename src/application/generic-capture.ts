import { captureShortStatusJson } from '../platform/short-status.js';
import { RuntimeError } from '../runtime/store.js';
import { type GenericCaptureOperation } from './contracts/generic-write.js';

interface Dependencies {}

export function createGenericCapture(deps: Dependencies): GenericCaptureOperation {
  function genericCapture<T>(input: T): T {
    try {
      return captureShortStatusJson(input) as T;
    } catch {
      throw new RuntimeError(
        'capability_unavailable',
        'Generic short publication status is unavailable.',
      );
    }
  }
  return genericCapture;
}
