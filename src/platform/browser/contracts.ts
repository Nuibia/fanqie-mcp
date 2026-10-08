import { type ChapterVolumeRefreshDiagnostic, type DatasetResult } from '../reads.js';

import { type LoginState } from './own-identity.js';

import { type ChapterBodyRecord } from '../chapter-body.js';

export const WRITER_HOME = 'https://fanqienovel.com/main/writer/short-manage';

// Actual official own-account GET and string data.id schema were verified on 2026-10-03.
export const CANONICAL_OWN_USER_URL = 'https://fanqienovel.com/api/user/info/v2';

export interface BrowserSessionConfig {
  profileDir: string;
  headless: boolean;
  executablePath?: string;
  timeoutMs?: number;
  /** Total time allowed for one active browser call; independent of Playwright action timeouts. */
  operationTimeoutMs?: number;
  /** Opt-in Docker recovery only; never enabled merely because a Chromium launch failed. */
  recoverStaleProfileLocks?: boolean;
  /** Must synchronously verify the application's exclusive Store lease before any lock recovery. */
  assertProfileRecoveryLease?: () => void;
}

export interface BrowserCallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ChapterDirectoryCallOptions extends BrowserCallOptions {
  /** Synchronous fixed DTO callback; never accepts source URLs, response values or outside error properties. */
  onVolumeRefreshDiagnostic?: (diagnostic: ChapterVolumeRefreshDiagnostic) => void;
}

/** Internal application call only: neither MCP inputs nor a reusable transport capability. */
export interface CurrentChapterDirectoryOptions extends BrowserCallOptions {
  jobId: string;
  expectedOwner: { kind: 'account' | 'author'; id: string };
  onVerifiedOwner: (state: LoginState) => void;
}

export interface CurrentChapterBodyRead {
  chapterId: string;
  deadline: number;
  result: DatasetResult<ChapterBodyRecord>;
}
