import { NativeShortCoverError } from './short-native-cover.js';

export const CODES = {
  reference: 'native_short_cover_invalid_reference',
  source: 'native_short_cover_invalid_source',
  hash: 'native_short_cover_source_hash_mismatch',
  image: 'native_short_cover_invalid_image',
  aborted: 'native_short_cover_aborted',
  timeout: 'native_short_cover_timeout',
  prepare: 'native_short_cover_image_prepare_failed',
  cleanup: 'native_short_cover_image_cleanup_failed',
} as const;

export const SAFE_CODES = new Set<string>(Object.values(CODES));

export function fail(code: string): never {
  throw new NativeShortCoverError(code);
}
