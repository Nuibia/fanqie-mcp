import { AppError } from '../errors.js';
import { type CaptureDirectoryToolInputOperation } from './contracts/tool-input.js';

interface Dependencies {}

export function createCaptureDirectoryToolInput(
  deps: Dependencies,
): CaptureDirectoryToolInputOperation {
  function captureDirectoryToolInput(name: string, input: unknown): unknown {
    if (name !== 'list_short_drafts') return input;
    try {
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
        Reflect.ownKeys(input).length !== 0
      )
        throw Error('Invalid directory input');
      return {};
    } catch {
      throw new AppError('invalid_input', 'Short draft directory input must be an empty object.');
    }
  }
  return captureDirectoryToolInput;
}
