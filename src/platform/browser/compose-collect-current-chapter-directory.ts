import { type BrowserOwner } from './owner.js';
import { type BrowserSession } from './session.js';
import { type BrowserOperations } from './operations.js';
import { createCollectCurrentChapterDirectory } from './operations/collect-current-chapter-directory.js';
import { createCollectCurrentChapterBody } from './operations/collect-current-chapter-body.js';
import { createCollectChapterDirectoryRead } from './operations/collect-chapter-directory-read.js';
import { createCollectCurrentChapterDraftDirectory } from './operations/collect-current-chapter-draft-directory.js';
import { createOpenOwnedChapterDraftTab } from './operations/open-owned-chapter-draft-tab.js';
export function composeCollectCurrentChapterDirectory(
  owner: BrowserOwner,
  session: BrowserSession,
  operations: BrowserOperations,
): void {
  operations.collectCurrentChapterDirectory = createCollectCurrentChapterDirectory({
    get assertAccountUsable() {
      return owner.assertAccountUsable.bind(owner);
    },
    get collectChapterDirectoryRead() {
      return owner.collectChapterDirectoryRead.bind(owner);
    },
  });
  operations.collectCurrentChapterBody = createCollectCurrentChapterBody({
    get assertAccountUsable() {
      return owner.assertAccountUsable.bind(owner);
    },
    get ownsPageSlot() {
      return owner.ownsPageSlot.bind(owner);
    },
    get collectChapterDirectoryRead() {
      return owner.collectChapterDirectoryRead.bind(owner);
    },
  });
  operations.collectChapterDirectoryRead = createCollectChapterDirectoryRead({
    get ownsPageSlot() {
      return owner.ownsPageSlot.bind(owner);
    },
    get pageSlots() {
      return owner.pageSlots;
    },
    set pageSlots(value) {
      owner.pageSlots = value;
    },
    get isCurrentPageSlot() {
      return owner.isCurrentPageSlot.bind(owner);
    },
    get config() {
      return owner.config;
    },
    set config(value) {
      owner.config = value;
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
    get waitForWriterReady() {
      return owner.waitForWriterReady.bind(owner);
    },
    get openExistingChapterDirectory() {
      return owner.openExistingChapterDirectory.bind(owner);
    },
    get readCurrentChapterContext() {
      return owner.readCurrentChapterContext.bind(owner);
    },
  });
  operations.collectCurrentChapterDraftDirectory = createCollectCurrentChapterDraftDirectory({
    get assertAccountUsable() {
      return owner.assertAccountUsable.bind(owner);
    },
    get ownsPageSlot() {
      return owner.ownsPageSlot.bind(owner);
    },
    get pageSlots() {
      return owner.pageSlots;
    },
    set pageSlots(value) {
      owner.pageSlots = value;
    },
    get isCurrentPageSlot() {
      return owner.isCurrentPageSlot.bind(owner);
    },
    get config() {
      return owner.config;
    },
    set config(value) {
      owner.config = value;
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
    get waitForWriterReady() {
      return owner.waitForWriterReady.bind(owner);
    },
    get openExistingChapterDirectory() {
      return owner.openExistingChapterDirectory.bind(owner);
    },
    get openOwnedChapterDraftTab() {
      return owner.openOwnedChapterDraftTab.bind(owner);
    },
    get readCurrentChapterDraftContext() {
      return owner.readCurrentChapterDraftContext.bind(owner);
    },
  });
  operations.openOwnedChapterDraftTab = createOpenOwnedChapterDraftTab({
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
    get context() {
      return owner.context;
    },
    set context(value) {
      owner.context = value;
    },
    get discoveredStableTargets() {
      return owner.discoveredStableTargets;
    },
    set discoveredStableTargets(value) {
      owner.discoveredStableTargets = value;
    },
    get isCurrentPageSlot() {
      return owner.isCurrentPageSlot.bind(owner);
    },
  });
}
