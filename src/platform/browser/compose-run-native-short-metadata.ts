import { type BrowserOwner } from './owner.js';
import { type BrowserSession } from './session.js';
import { type BrowserOperations } from './operations.js';
import { createRunNativeShortMetadata } from './operations/run-native-short-metadata.js';
import { createRunNativeShortMetadataUpdate } from './operations/run-native-short-metadata-update.js';
import { createRunNativeShortCoverUpdate } from './operations/run-native-short-cover-update.js';
import { createRunNativeShortTrialUpdate } from './operations/run-native-short-trial-update.js';
import { createRunNativeShortSubmission } from './operations/run-native-short-submission.js';
export function composeRunNativeShortMetadata(
  owner: BrowserOwner,
  session: BrowserSession,
  operations: BrowserOperations,
): void {
  operations.runNativeShortMetadata = createRunNativeShortMetadata({
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
    get activeNativeShortMetadata() {
      return owner.activeNativeShortMetadata;
    },
    set activeNativeShortMetadata(value) {
      owner.activeNativeShortMetadata = value;
    },
  });
  operations.runNativeShortMetadataUpdate = createRunNativeShortMetadataUpdate({
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
    get activeNativeShortMetadataWrite() {
      return owner.activeNativeShortMetadataWrite;
    },
    set activeNativeShortMetadataWrite(value) {
      owner.activeNativeShortMetadataWrite = value;
    },
  });
  operations.runNativeShortCoverUpdate = createRunNativeShortCoverUpdate({
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
    get activeNativeShortCover() {
      return owner.activeNativeShortCover;
    },
    set activeNativeShortCover(value) {
      owner.activeNativeShortCover = value;
    },
  });
  operations.runNativeShortTrialUpdate = createRunNativeShortTrialUpdate({
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
    get activeNativeShortTrial() {
      return owner.activeNativeShortTrial;
    },
    set activeNativeShortTrial(value) {
      owner.activeNativeShortTrial = value;
    },
  });
  operations.runNativeShortSubmission = createRunNativeShortSubmission({
    get runNativeShortSubmissionOwned() {
      return owner.runNativeShortSubmissionOwned.bind(owner);
    },
  });
}
