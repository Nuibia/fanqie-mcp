import { type BrowserOwner } from './owner.js';
import { type BrowserSession } from './session.js';
import { type BrowserOperations } from './operations.js';
import { createClose } from './operations/close.js';
export function composeClose(
  owner: BrowserOwner,
  session: BrowserSession,
  operations: BrowserOperations,
): void {
  operations.close = createClose({
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
    get activeShortMetadata() {
      return owner.activeShortMetadata;
    },
    set activeShortMetadata(value) {
      owner.activeShortMetadata = value;
    },
    get activeShortMetadataApi() {
      return owner.activeShortMetadataApi;
    },
    set activeShortMetadataApi(value) {
      owner.activeShortMetadataApi = value;
    },
    get activeShortDraftDirectory() {
      return owner.activeShortDraftDirectory;
    },
    set activeShortDraftDirectory(value) {
      owner.activeShortDraftDirectory = value;
    },
    get activeNativeShortMetadata() {
      return owner.activeNativeShortMetadata;
    },
    set activeNativeShortMetadata(value) {
      owner.activeNativeShortMetadata = value;
    },
    get activeNativeShortMetadataWrite() {
      return owner.activeNativeShortMetadataWrite;
    },
    set activeNativeShortMetadataWrite(value) {
      owner.activeNativeShortMetadataWrite = value;
    },
    get activeNativeShortCover() {
      return owner.activeNativeShortCover;
    },
    set activeNativeShortCover(value) {
      owner.activeNativeShortCover = value;
    },
    get activeNativeShortTrial() {
      return owner.activeNativeShortTrial;
    },
    set activeNativeShortTrial(value) {
      owner.activeNativeShortTrial = value;
    },
    get activeNativeShortSubmission() {
      return owner.activeNativeShortSubmission;
    },
    set activeNativeShortSubmission(value) {
      owner.activeNativeShortSubmission = value;
    },
    get activeNativeShortBody() {
      return owner.activeNativeShortBody;
    },
    set activeNativeShortBody(value) {
      owner.activeNativeShortBody = value;
    },
    get apiQuarantined() {
      return owner.apiQuarantined;
    },
    set apiQuarantined(value) {
      owner.apiQuarantined = value;
    },
    get context() {
      return owner.context;
    },
    set context(value) {
      owner.context = value;
    },
    get queue() {
      return owner.queue;
    },
    set queue(value) {
      owner.queue = value;
    },
    get page() {
      return owner.page;
    },
    set page(value) {
      owner.page = value;
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
  });
}
