import { type BrowserOwner } from './owner.js';
import { type BrowserSession } from './session.js';
import { type BrowserOperations } from './operations.js';
import { createAssertAccountUsable } from './operations/assert-account-usable.js';
import { createIsCurrentPageSlot } from './operations/is-current-page-slot.js';
import { createOwnsPageSlot } from './operations/owns-page-slot.js';
import { createObserveIdentity } from './operations/observe-identity.js';
import { createRememberIdentity } from './operations/remember-identity.js';
export function composeAssertAccountUsable(
  owner: BrowserOwner,
  session: BrowserSession,
  operations: BrowserOperations,
): void {
  operations.assertAccountUsable = createAssertAccountUsable({
    get apiQuarantined() {
      return owner.apiQuarantined;
    },
    set apiQuarantined(value) {
      owner.apiQuarantined = value;
    },
  });
  operations.isCurrentPageSlot = createIsCurrentPageSlot({
    get activePageSlot() {
      return owner.activePageSlot;
    },
    set activePageSlot(value) {
      owner.activePageSlot = value;
    },
    get context() {
      return owner.context;
    },
    set context(value) {
      owner.context = value;
    },
    get activeReaderPage() {
      return owner.activeReaderPage;
    },
    set activeReaderPage(value) {
      owner.activeReaderPage = value;
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
    get apiQuarantined() {
      return owner.apiQuarantined;
    },
    set apiQuarantined(value) {
      owner.apiQuarantined = value;
    },
  });
  operations.ownsPageSlot = createOwnsPageSlot({
    get isCurrentPageSlot() {
      return owner.isCurrentPageSlot.bind(owner);
    },
    get pageSlots() {
      return owner.pageSlots;
    },
    set pageSlots(value) {
      owner.pageSlots = value;
    },
  });
  operations.observeIdentity = createObserveIdentity({
    get ownInfoUrls() {
      return owner.ownInfoUrls;
    },
    set ownInfoUrls(value) {
      owner.ownInfoUrls = value;
    },
    get pageGetMetadata() {
      return owner.pageGetMetadata;
    },
    set pageGetMetadata(value) {
      owner.pageGetMetadata = value;
    },
    get pageOwnStructures() {
      return owner.pageOwnStructures;
    },
    set pageOwnStructures(value) {
      owner.pageOwnStructures = value;
    },
    get pageReadStructures() {
      return owner.pageReadStructures;
    },
    set pageReadStructures(value) {
      owner.pageReadStructures = value;
    },
    get page() {
      return owner.page;
    },
    set page(value) {
      owner.page = value;
    },
    get identityEpoch() {
      return owner.identityEpoch;
    },
    set identityEpoch(value) {
      owner.identityEpoch = value;
    },
    get identity() {
      return owner.identity;
    },
    set identity(value) {
      owner.identity = value;
    },
    get closed() {
      return owner.closed;
    },
    set closed(value) {
      owner.closed = value;
    },
    get rememberIdentity() {
      return owner.rememberIdentity.bind(owner);
    },
  });
  operations.rememberIdentity = createRememberIdentity({
    get identity() {
      return owner.identity;
    },
    set identity(value) {
      owner.identity = value;
    },
  });
}
