import { type BrowserOwner } from './owner.js';
import { type BrowserSession } from './session.js';
import { type BrowserOperations } from './operations.js';
import { composeAssertAccountUsable } from './compose-assert-account-usable.js';
import { composeEnsurePage } from './compose-ensure-page.js';
import { composeRunNativeShortMetadata } from './compose-run-native-short-metadata.js';
import { composeRunNativeShortSubmissionFixture } from './compose-run-native-short-submission-fixture.js';
import { composeRead } from './compose-read.js';
import { composeDiagnoseCurrentLoginPage } from './compose-diagnose-current-login-page.js';
import { composeWaitForWriterReady } from './compose-wait-for-writer-ready.js';
import { composeCollectCurrentChapterDirectory } from './compose-collect-current-chapter-directory.js';
import { composeReadCurrentChapterDraftContext } from './compose-read-current-chapter-draft-context.js';
import { composeClose } from './compose-close.js';
export function composeBrowserOperations(
  owner: BrowserOwner,
  session: BrowserSession,
): BrowserOperations {
  const operations = {} as BrowserOperations;
  composeAssertAccountUsable(owner, session, operations);
  composeEnsurePage(owner, session, operations);
  composeRunNativeShortMetadata(owner, session, operations);
  composeRunNativeShortSubmissionFixture(owner, session, operations);
  composeRead(owner, session, operations);
  composeDiagnoseCurrentLoginPage(owner, session, operations);
  composeWaitForWriterReady(owner, session, operations);
  composeCollectCurrentChapterDirectory(owner, session, operations);
  composeReadCurrentChapterDraftContext(owner, session, operations);
  composeClose(owner, session, operations);
  return operations;
}
