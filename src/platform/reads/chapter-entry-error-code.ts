import { CHAPTER_ENTRY_ERROR_CODES } from './parse-chapter-draft-page.js';

/** External browser entry errors cross this boundary by fixed enum only, never raw messages or URLs. */
export function chapterEntryErrorCode(error: unknown): string {
  try {
    if (!error || typeof error !== 'object' || Array.isArray(error)) return 'chapter_read_failed';
    const code = Object.getOwnPropertyDescriptor(error, 'code');
    return code &&
      'value' in code &&
      typeof code.value === 'string' &&
      CHAPTER_ENTRY_ERROR_CODES.has(code.value)
      ? code.value
      : 'chapter_read_failed';
  } catch {
    return 'chapter_read_failed';
  }
}
