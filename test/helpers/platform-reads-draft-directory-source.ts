import { CHAPTER_ENTRY_FIXTURE_WORK } from './platform-reads-chapter-entry-fixture-work.js';

export const DRAFT_DIRECTORY_SOURCE = `https://fanqienovel.com/api/author/chapter/draft_list/v1?book_id=${CHAPTER_ENTRY_FIXTURE_WORK}&page_index=0&page_count=1&opaque_fixture=PRIVATE_DRAFT_TOKEN%2fA`;

export const DRAFT_DIRECTORY_NEXT = DRAFT_DIRECTORY_SOURCE.replace(
  'page_index=0',
  'page_index=1',
).replace('%2fA', '%2fB');
