import { type BrowserOwner } from './owner.js';
import { type BrowserSession } from './session.js';
import { type BrowserOperations } from './operations.js';
import { createEnsurePage } from './operations/ensure-page.js';
import { createWithPage } from './operations/with-page.js';
import { createDiagnoseShortMetadataSchema } from './operations/diagnose-short-metadata-schema.js';
import { createDiagnoseShortMetadataApiSchema } from './operations/diagnose-short-metadata-api-schema.js';
import { createRunShortDraftDirectory } from './operations/run-short-draft-directory.js';
export function composeEnsurePage(
  owner: BrowserOwner,
  session: BrowserSession,
  operations: BrowserOperations,
): void {
  operations.ensurePage = createEnsurePage({
    get apiQuarantined() {
      return owner.apiQuarantined;
    },
    set apiQuarantined(value) {
      owner.apiQuarantined = value;
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
    get config() {
      return owner.config;
    },
    set config(value) {
      owner.config = value;
    },
    get page() {
      return owner.page;
    },
    set page(value) {
      owner.page = value;
    },
    get observeIdentity() {
      return owner.observeIdentity.bind(owner);
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
    get qrLoginPage() {
      return owner.qrLoginPage;
    },
    set qrLoginPage(value) {
      owner.qrLoginPage = value;
    },
  });
  operations.withPage = createWithPage({
    get assertAccountUsable() {
      return owner.assertAccountUsable.bind(owner);
    },
    get config() {
      return owner.config;
    },
    set config(value) {
      owner.config = value;
    },
    get queue() {
      return owner.queue;
    },
    set queue(value) {
      owner.queue = value;
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
    get page() {
      return owner.page;
    },
    set page(value) {
      owner.page = value;
    },
    get qrLoginPage() {
      return owner.qrLoginPage;
    },
    set qrLoginPage(value) {
      owner.qrLoginPage = value;
    },
    get context() {
      return owner.context;
    },
    set context(value) {
      owner.context = value;
    },
    get ensurePage() {
      return owner.ensurePage.bind(owner);
    },
    get activePageSlot() {
      return owner.activePageSlot;
    },
    set activePageSlot(value) {
      owner.activePageSlot = value;
    },
    get activeReaderPage() {
      return owner.activeReaderPage;
    },
    set activeReaderPage(value) {
      owner.activeReaderPage = value;
    },
    get pageSlots() {
      return owner.pageSlots;
    },
    set pageSlots(value) {
      owner.pageSlots = value;
    },
    get closed() {
      return owner.closed;
    },
    set closed(value) {
      owner.closed = value;
    },
  });
  operations.diagnoseShortMetadataSchema = createDiagnoseShortMetadataSchema({
    get config() {
      return owner.config;
    },
    set config(value) {
      owner.config = value;
    },
    get queue() {
      return owner.queue;
    },
    set queue(value) {
      owner.queue = value;
    },
    get apiQuarantined() {
      return owner.apiQuarantined;
    },
    set apiQuarantined(value) {
      owner.apiQuarantined = value;
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
    get identityEpoch() {
      return owner.identityEpoch;
    },
    set identityEpoch(value) {
      owner.identityEpoch = value;
    },
    get activeShortMetadata() {
      return owner.activeShortMetadata;
    },
    set activeShortMetadata(value) {
      owner.activeShortMetadata = value;
    },
  });
  operations.diagnoseShortMetadataApiSchema = createDiagnoseShortMetadataApiSchema({
    get config() {
      return owner.config;
    },
    set config(value) {
      owner.config = value;
    },
    get queue() {
      return owner.queue;
    },
    set queue(value) {
      owner.queue = value;
    },
    get apiQuarantined() {
      return owner.apiQuarantined;
    },
    set apiQuarantined(value) {
      owner.apiQuarantined = value;
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
    get identityEpoch() {
      return owner.identityEpoch;
    },
    set identityEpoch(value) {
      owner.identityEpoch = value;
    },
    get activeShortMetadataApi() {
      return owner.activeShortMetadataApi;
    },
    set activeShortMetadataApi(value) {
      owner.activeShortMetadataApi = value;
    },
  });
  operations.runShortDraftDirectory = createRunShortDraftDirectory({
    get config() {
      return owner.config;
    },
    set config(value) {
      owner.config = value;
    },
    get queue() {
      return owner.queue;
    },
    set queue(value) {
      owner.queue = value;
    },
    get apiQuarantined() {
      return owner.apiQuarantined;
    },
    set apiQuarantined(value) {
      owner.apiQuarantined = value;
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
    get identityEpoch() {
      return owner.identityEpoch;
    },
    set identityEpoch(value) {
      owner.identityEpoch = value;
    },
    get activeShortDraftDirectory() {
      return owner.activeShortDraftDirectory;
    },
    set activeShortDraftDirectory(value) {
      owner.activeShortDraftDirectory = value;
    },
  });
}
