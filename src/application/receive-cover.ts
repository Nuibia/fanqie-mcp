import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { type Config } from '../config.js';
import { AppError } from '../errors.js';
import { Store } from '../runtime/store.js';
import { coverUploadSchema } from './shared.js';
import { type ReceiveCoverOperation } from './contracts/tool-input.js';

interface Dependencies {
  store: Store;
  config: Config;
}

export function createReceiveCover(deps: Dependencies): ReceiveCoverOperation {
  function receiveCover(body: unknown) {
    deps.store.assertPublicReadMutationAllowed();
    const input = coverUploadSchema.parse(body);
    const bytes = Buffer.from(input.data, 'base64');
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = bytes[0] === 255 && bytes[1] === 216;
    const webp =
      bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
    if (!(input.mimeType === 'image/png' ? png : input.mimeType === 'image/jpeg' ? jpeg : webp))
      throw new AppError('invalid_image', 'Image signature differs from declared type');
    const filename = `${randomUUID()}.${input.mimeType === 'image/png' ? 'png' : input.mimeType === 'image/jpeg' ? 'jpg' : 'webp'}`;
    writeFileSync(path.join(deps.config.uploadDir, filename), bytes, { mode: 0o600, flag: 'wx' });
    return {
      uploadPath: filename,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
    };
  }
  return receiveCover;
}
