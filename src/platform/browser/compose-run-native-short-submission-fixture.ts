import { type BrowserOwner } from './owner.js';
import { type BrowserSession } from './session.js';
import { type BrowserOperations } from './operations.js';
import { createRunNativeShortSubmissionFixture } from './operations/run-native-short-submission-fixture.js';
import { createRunNativeShortSubmissionOwned } from './operations/run-native-short-submission-owned.js';
import { createRunNativeShortBodyUpdate } from './operations/run-native-short-body-update.js';
import { createRunNativeShortBodyFixtureUpdate } from './operations/run-native-short-body-fixture-update.js';
import { createRunNativeShortBodyOwned } from './operations/run-native-short-body-owned.js';
export function composeRunNativeShortSubmissionFixture(
  owner: BrowserOwner,
  session: BrowserSession,
  operations: BrowserOperations,
): void {
  operations.runNativeShortSubmissionFixture = createRunNativeShortSubmissionFixture({
    get runNativeShortSubmissionOwned() {
      return owner.runNativeShortSubmissionOwned.bind(owner);
    },
  });
  operations.runNativeShortSubmissionOwned = createRunNativeShortSubmissionOwned({
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
    get activeNativeShortSubmission() {
      return owner.activeNativeShortSubmission;
    },
    set activeNativeShortSubmission(value) {
      owner.activeNativeShortSubmission = value;
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
  });
  operations.runNativeShortBodyUpdate = createRunNativeShortBodyUpdate({
    get runNativeShortBodyOwned() {
      return owner.runNativeShortBodyOwned.bind(owner);
    },
  });
  operations.runNativeShortBodyFixtureUpdate = createRunNativeShortBodyFixtureUpdate({
    get runNativeShortBodyOwned() {
      return owner.runNativeShortBodyOwned.bind(owner);
    },
  });
  operations.runNativeShortBodyOwned = createRunNativeShortBodyOwned({
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
    get activeNativeShortBody() {
      return owner.activeNativeShortBody;
    },
    set activeNativeShortBody(value) {
      owner.activeNativeShortBody = value;
    },
  });
}
