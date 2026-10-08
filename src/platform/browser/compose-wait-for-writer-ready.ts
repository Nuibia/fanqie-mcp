import { type BrowserOwner } from './owner.js';
import { type BrowserSession } from './session.js';
import { type BrowserOperations } from './operations.js';
import { createWaitForWriterReady } from './operations/wait-for-writer-ready.js';
import { createWaitForObservedOwnSource } from './operations/wait-for-observed-own-source.js';
import { createEnterCurrentChapterDirectory } from './operations/enter-current-chapter-directory.js';
import { createOpenExistingChapterDirectory } from './operations/open-existing-chapter-directory.js';
import { createOpenChapterDraftTab } from './operations/open-chapter-draft-tab.js';
export function composeWaitForWriterReady(
  owner: BrowserOwner,
  session: BrowserSession,
  operations: BrowserOperations,
): void {
  operations.waitForWriterReady = createWaitForWriterReady({});
  operations.waitForObservedOwnSource = createWaitForObservedOwnSource({
    get ownInfoUrls() {
      return owner.ownInfoUrls;
    },
    set ownInfoUrls(value) {
      owner.ownInfoUrls = value;
    },
  });
  operations.enterCurrentChapterDirectory = createEnterCurrentChapterDirectory({
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
    get discoveredStableTargets() {
      return owner.discoveredStableTargets;
    },
    set discoveredStableTargets(value) {
      owner.discoveredStableTargets = value;
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
    get closed() {
      return owner.closed;
    },
    set closed(value) {
      owner.closed = value;
    },
    get activeReaderPage() {
      return owner.activeReaderPage;
    },
    set activeReaderPage(value) {
      owner.activeReaderPage = value;
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
    get diagnosticTargets() {
      return owner.diagnosticTargets;
    },
    set diagnosticTargets(value) {
      owner.diagnosticTargets = value;
    },
  });
  operations.openExistingChapterDirectory = createOpenExistingChapterDirectory({
    get activePageSlot() {
      return owner.activePageSlot;
    },
    set activePageSlot(value) {
      owner.activePageSlot = value;
    },
    get identityEpoch() {
      return owner.identityEpoch;
    },
    set identityEpoch(value) {
      owner.identityEpoch = value;
    },
    get isCurrentPageSlot() {
      return owner.isCurrentPageSlot.bind(owner);
    },
    get discoveredStableTargets() {
      return owner.discoveredStableTargets;
    },
    set discoveredStableTargets(value) {
      owner.discoveredStableTargets = value;
    },
    get waitForWriterReady() {
      return owner.waitForWriterReady.bind(owner);
    },
    get verifyCurrentAccount() {
      return owner.verifyCurrentAccount.bind(owner);
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
  });
  operations.openChapterDraftTab = createOpenChapterDraftTab({
    get activePageSlot() {
      return owner.activePageSlot;
    },
    set activePageSlot(value) {
      owner.activePageSlot = value;
    },
    get discoveredStableTargets() {
      return owner.discoveredStableTargets;
    },
    set discoveredStableTargets(value) {
      owner.discoveredStableTargets = value;
    },
    get identityEpoch() {
      return owner.identityEpoch;
    },
    set identityEpoch(value) {
      owner.identityEpoch = value;
    },
    get isCurrentPageSlot() {
      return owner.isCurrentPageSlot.bind(owner);
    },
    get verifyCurrentAccount() {
      return owner.verifyCurrentAccount.bind(owner);
    },
    get diagnosticTargets() {
      return owner.diagnosticTargets;
    },
    set diagnosticTargets(value) {
      owner.diagnosticTargets = value;
    },
  });
}
