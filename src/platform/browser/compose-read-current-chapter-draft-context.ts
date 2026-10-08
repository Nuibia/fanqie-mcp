import { type BrowserOwner } from './owner.js';
import { type BrowserSession } from './session.js';
import { type BrowserOperations } from './operations.js';
import { createReadCurrentChapterDraftContext } from './operations/read-current-chapter-draft-context.js';
import { createDiagnoseChapterVolumeContext } from './operations/diagnose-chapter-volume-context.js';
import { createReadCurrentChapterContext } from './operations/read-current-chapter-context.js';
import { createPrepareChapterDiagnostic } from './operations/prepare-chapter-diagnostic.js';
import { createDiagnoseReadPage } from './operations/diagnose-read-page.js';
export function composeReadCurrentChapterDraftContext(
  owner: BrowserOwner,
  session: BrowserSession,
  operations: BrowserOperations,
): void {
  operations.readCurrentChapterDraftContext = createReadCurrentChapterDraftContext({
    get activePageSlot() {
      return owner.activePageSlot;
    },
    set activePageSlot(value) {
      owner.activePageSlot = value;
    },
    get diagnosticTargets() {
      return owner.diagnosticTargets;
    },
    set diagnosticTargets(value) {
      owner.diagnosticTargets = value;
    },
    get discoveredStableTargets() {
      return owner.discoveredStableTargets;
    },
    set discoveredStableTargets(value) {
      owner.discoveredStableTargets = value;
    },
    get config() {
      return owner.config;
    },
    set config(value) {
      owner.config = value;
    },
    get isCurrentPageSlot() {
      return owner.isCurrentPageSlot.bind(owner);
    },
    get identityEpoch() {
      return owner.identityEpoch;
    },
    set identityEpoch(value) {
      owner.identityEpoch = value;
    },
    get page() {
      return owner.page;
    },
    set page(value) {
      owner.page = value;
    },
    get activeReaderPage() {
      return owner.activeReaderPage;
    },
    set activeReaderPage(value) {
      owner.activeReaderPage = value;
    },
    get closed() {
      return owner.closed;
    },
    set closed(value) {
      owner.closed = value;
    },
    get context() {
      return owner.context;
    },
    set context(value) {
      owner.context = value;
    },
    get chapterTargetOwners() {
      return owner.chapterTargetOwners;
    },
    set chapterTargetOwners(value) {
      owner.chapterTargetOwners = value;
    },
    get waitForWriterReady() {
      return owner.waitForWriterReady.bind(owner);
    },
  });
  operations.diagnoseChapterVolumeContext = createDiagnoseChapterVolumeContext({
    get diagnosticTargets() {
      return owner.diagnosticTargets;
    },
    set diagnosticTargets(value) {
      owner.diagnosticTargets = value;
    },
    get discoveredStableTargets() {
      return owner.discoveredStableTargets;
    },
    set discoveredStableTargets(value) {
      owner.discoveredStableTargets = value;
    },
    get withPage() {
      return owner.withPage.bind(owner);
    },
    get readCurrentChapterContext() {
      return owner.readCurrentChapterContext.bind(owner);
    },
  });
  operations.readCurrentChapterContext = createReadCurrentChapterContext({
    get activePageSlot() {
      return owner.activePageSlot;
    },
    set activePageSlot(value) {
      owner.activePageSlot = value;
    },
    get diagnosticTargets() {
      return owner.diagnosticTargets;
    },
    set diagnosticTargets(value) {
      owner.diagnosticTargets = value;
    },
    get discoveredStableTargets() {
      return owner.discoveredStableTargets;
    },
    set discoveredStableTargets(value) {
      owner.discoveredStableTargets = value;
    },
    get config() {
      return owner.config;
    },
    set config(value) {
      owner.config = value;
    },
    get isCurrentPageSlot() {
      return owner.isCurrentPageSlot.bind(owner);
    },
    get identityEpoch() {
      return owner.identityEpoch;
    },
    set identityEpoch(value) {
      owner.identityEpoch = value;
    },
    get page() {
      return owner.page;
    },
    set page(value) {
      owner.page = value;
    },
    get activeReaderPage() {
      return owner.activeReaderPage;
    },
    set activeReaderPage(value) {
      owner.activeReaderPage = value;
    },
    get closed() {
      return owner.closed;
    },
    set closed(value) {
      owner.closed = value;
    },
    get context() {
      return owner.context;
    },
    set context(value) {
      owner.context = value;
    },
    get chapterTargetOwners() {
      return owner.chapterTargetOwners;
    },
    set chapterTargetOwners(value) {
      owner.chapterTargetOwners = value;
    },
    get verifyCurrentAccount() {
      return owner.verifyCurrentAccount.bind(owner);
    },
    get waitForWriterReady() {
      return owner.waitForWriterReady.bind(owner);
    },
  });
  operations.prepareChapterDiagnostic = createPrepareChapterDiagnostic({
    get activePageSlot() {
      return owner.activePageSlot;
    },
    set activePageSlot(value) {
      owner.activePageSlot = value;
    },
    get diagnosticTargets() {
      return owner.diagnosticTargets;
    },
    set diagnosticTargets(value) {
      owner.diagnosticTargets = value;
    },
    get chapterTargetOwners() {
      return owner.chapterTargetOwners;
    },
    set chapterTargetOwners(value) {
      owner.chapterTargetOwners = value;
    },
    get discoveredStableTargets() {
      return owner.discoveredStableTargets;
    },
    set discoveredStableTargets(value) {
      owner.discoveredStableTargets = value;
    },
    get context() {
      return owner.context;
    },
    set context(value) {
      owner.context = value;
    },
    get isCurrentPageSlot() {
      return owner.isCurrentPageSlot.bind(owner);
    },
    get identityEpoch() {
      return owner.identityEpoch;
    },
    set identityEpoch(value) {
      owner.identityEpoch = value;
    },
    get verifyCurrentAccount() {
      return owner.verifyCurrentAccount.bind(owner);
    },
  });
  operations.diagnoseReadPage = createDiagnoseReadPage({
    get diagnoseChapterVolumeContext() {
      return owner.diagnoseChapterVolumeContext.bind(owner);
    },
    get diagnosticTargets() {
      return owner.diagnosticTargets;
    },
    set diagnosticTargets(value) {
      owner.diagnosticTargets = value;
    },
    get discoveredStableTargets() {
      return owner.discoveredStableTargets;
    },
    set discoveredStableTargets(value) {
      owner.discoveredStableTargets = value;
    },
    get withPage() {
      return owner.withPage.bind(owner);
    },
    get page() {
      return owner.page;
    },
    set page(value) {
      owner.page = value;
    },
    get closed() {
      return owner.closed;
    },
    set closed(value) {
      owner.closed = value;
    },
    get identityEpoch() {
      return owner.identityEpoch;
    },
    set identityEpoch(value) {
      owner.identityEpoch = value;
    },
    get config() {
      return owner.config;
    },
    set config(value) {
      owner.config = value;
    },
    get waitForWriterReady() {
      return owner.waitForWriterReady.bind(owner);
    },
    get verifyCurrentAccount() {
      return owner.verifyCurrentAccount.bind(owner);
    },
    get ownInfoUrls() {
      return owner.ownInfoUrls;
    },
    set ownInfoUrls(value) {
      owner.ownInfoUrls = value;
    },
    get waitForObservedOwnSource() {
      return owner.waitForObservedOwnSource.bind(owner);
    },
    get openExistingChapterDirectory() {
      return owner.openExistingChapterDirectory.bind(owner);
    },
    get prepareChapterDiagnostic() {
      return owner.prepareChapterDiagnostic.bind(owner);
    },
    get openChapterDraftTab() {
      return owner.openChapterDraftTab.bind(owner);
    },
    get pageReadStructures() {
      return owner.pageReadStructures;
    },
    set pageReadStructures(value) {
      owner.pageReadStructures = value;
    },
  });
}
