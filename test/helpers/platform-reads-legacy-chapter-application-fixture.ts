import {
  CHAPTER_ENTRY_FIXTURE_WORK,
  CHAPTER_ENTRY_FIXTURE_TITLE,
} from './platform-reads-chapter-entry-fixture-work.js';

import { CHAPTER_SCHEMA_FIXTURE_SOURCES } from './platform-reads-chapter-core-row.js';

import assert from 'node:assert/strict';

import { BrowserSession } from '../../src/platform/browser.js';

import { type ChapterVolumeRefreshDiagnostic, collectChapters } from '../../src/platform/reads.js';

export const volumeEventContext = (overrides: Record<string, unknown> = {}) => ({
  event: 'request' as const,
  workId: CHAPTER_ENTRY_FIXTURE_WORK,
  template: CHAPTER_SCHEMA_FIXTURE_SOURCES[0]!.url,
  mainFrame: null,
  requestEpoch: 7,
  refreshEpoch: 7,
  currentEpoch: 7,
  samePage: true,
  activeSlot: true,
  pageOpen: true,
  sessionOpen: true,
  signalAborted: false,
  strictSourceMatch: true,
  ...overrides,
});

const volumeMetadataSecrets = [
  CHAPTER_ENTRY_FIXTURE_WORK,
  CHAPTER_ENTRY_FIXTURE_TITLE,
  'PRIVATE_',
  'nonce',
  'token',
  'owner_id',
  'book_id=',
  'https://',
  '/api/author/',
];

export const assertSafeVolumeMetadata = (diagnostic: unknown) => {
  const serialized = JSON.stringify(diagnostic);
  for (const secret of volumeMetadataSecrets)
    assert.equal(serialized.includes(secret), false, `No ${secret} metadata is serialized`);
};

// Test-only adapter: these two regressions continue to exercise the old callback
// boundary explicitly. The production builtin never falls back to this reader.
export function legacyChapterApplicationFixture(session: BrowserSession) {
  session.collectCurrentChapterDirectory = async (page, workId, options) => {
    let diagnostic: ChapterVolumeRefreshDiagnostic | undefined;
    const result = await collectChapters(page, {
      workId,
      enterDirectory: (current, id) =>
        session.enterCurrentChapterDirectory(current, id, {
          signal: options.signal,
          onVolumeRefreshDiagnostic: (value) => {
            diagnostic = value;
          },
        }),
    });
    if (result.status !== 'success' && diagnostic?.outcome === 'unverified')
      result.readDiagnostics = { chapterVolumeRefresh: diagnostic };
    return result as ReturnType<BrowserSession['collectCurrentChapterDirectory']> extends Promise<
      infer T
    >
      ? T
      : never;
  };
}

export const requestVolumeSource = () => ({
  ...CHAPTER_SCHEMA_FIXTURE_SOURCES[0]!,
  url: `https://fanqienovel.com/api/author/volume/volume_list/v1?book_id=${CHAPTER_ENTRY_FIXTURE_WORK}&nonce=PRIVATE_ORIGINAL_NONCE&opaque_signature=PRIVATE_SIG%2fVALUE&opaque_ticket=PRIVATE_TICKET`,
});

export const CONTEXT_PROBE_REF = 'ab'.repeat(12);

export const CONTEXT_PROBE_TARGET = `https://fanqienovel.com/main/writer/chapter-manage/${CHAPTER_ENTRY_FIXTURE_WORK}&${CHAPTER_ENTRY_FIXTURE_TITLE}?type=1`;

export const CONTEXT_PROBE_SOURCE = `https://fanqienovel.com/api/author/volume/volume_list/v1?book_id=${CHAPTER_ENTRY_FIXTURE_WORK}&opaque_fixture=PRIVATE_OPAQUE%2fPAIR`;

export type ContextBlockedFixture = {
  url: string;
  method: string;
  navigation?: boolean | 'unknown';
  subframe?: boolean;
  abortError?: boolean;
  resourceType?: string;
};

export type ContextOwnFixture = {
  responseStatus?: number;
  responseUrl?: string;
  json?: unknown;
  transportError?: boolean;
  jsonError?: boolean;
  disposeError?: boolean;
  duringGet?: () => Promise<void> | void;
  duringJson?: () => Promise<void> | void;
  duringDispose?: () => Promise<void> | void;
};
