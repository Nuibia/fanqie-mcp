import {
  type OwnedNativeShortSubmissionRunOwner,
  type OwnedNativeShortSubmissionRunGlobals,
  type OwnedNativeShortSubmissionRunOperations,
  type OwnedNativeShortSubmissionRun,
} from '../short-native-submission-api.js';
import { createOwnedNativeShortSubmissionRunLifecycle } from './lifecycle.js';
import { createOwnedNativeShortSubmissionRunTransport } from './transport.js';
import { createOwnedNativeShortSubmissionRunReceipts } from './receipts.js';
import { createOwnedNativeShortSubmissionRunRun } from './run.js';
export function composeOwnedNativeShortSubmissionRun(
  owner: OwnedNativeShortSubmissionRunOwner,
  identity: OwnedNativeShortSubmissionRun,
  globals: OwnedNativeShortSubmissionRunGlobals,
): OwnedNativeShortSubmissionRunOperations {
  const deps: OwnedNativeShortSubmissionRunOwner = {
    owner: identity,
    get options() {
      return owner.options;
    },
    set options(value) {
      owner.options = value;
    },
    get result() {
      return owner.result;
    },
    set result(value) {
      owner.result = value;
    },
    get api() {
      return owner.api;
    },
    set api(value) {
      owner.api = value;
    },
    get reason() {
      return owner.reason;
    },
    set reason(value) {
      owner.reason = value;
    },
    get postFailure() {
      return owner.postFailure;
    },
    set postFailure(value) {
      owner.postFailure = value;
    },
    get started() {
      return owner.started;
    },
    set started(value) {
      owner.started = value;
    },
    get timer() {
      return owner.timer;
    },
    set timer(value) {
      owner.timer = value;
    },
    get cleanupRequested() {
      return owner.cleanupRequested;
    },
    set cleanupRequested(value) {
      owner.cleanupRequested = value;
    },
    get cleanupResolved() {
      return owner.cleanupResolved;
    },
    set cleanupResolved(value) {
      owner.cleanupResolved = value;
    },
    get disposal() {
      return owner.disposal;
    },
    set disposal(value) {
      owner.disposal = value;
    },
    get pending() {
      return owner.pending;
    },
    set pending(value) {
      owner.pending = value;
    },
    get responses() {
      return owner.responses;
    },
    set responses(value) {
      owner.responses = value;
    },
    get finishCleanup() {
      return owner.finishCleanup;
    },
    set finishCleanup(value) {
      owner.finishCleanup = value;
    },
    get cleanupDone() {
      return owner.cleanupDone;
    },
    set cleanupDone(value) {
      owner.cleanupDone = value;
    },
    get notifyStopped() {
      return owner.notifyStopped;
    },
    set notifyStopped(value) {
      owner.notifyStopped = value;
    },
    get stopped() {
      return owner.stopped;
    },
    set stopped(value) {
      owner.stopped = value;
    },
    get activeConfirmation() {
      return owner.activeConfirmation;
    },
    set activeConfirmation(value) {
      owner.activeConfirmation = value;
    },
    get brands() {
      return owner.brands;
    },
    set brands(value) {
      owner.brands = value;
    },
    get minted() {
      return owner.minted;
    },
    set minted(value) {
      owner.minted = value;
    },
    get references() {
      return owner.references;
    },
    set references(value) {
      owner.references = value;
    },
    get receiptIdentity() {
      return owner.receiptIdentity;
    },
    set receiptIdentity(value) {
      owner.receiptIdentity = value;
    },
    get stop() {
      return owner.stop.bind(owner);
    },
    get fail() {
      return owner.fail.bind(owner);
    },
    get check() {
      return owner.check.bind(owner);
    },
    get quarantine() {
      return owner.quarantine.bind(owner);
    },
    get track() {
      return owner.track.bind(owner);
    },
    get wait() {
      return owner.wait.bind(owner);
    },
    get ownResponse() {
      return owner.ownResponse.bind(owner);
    },
    get disposeResponse() {
      return owner.disposeResponse.bind(owner);
    },
    get drain() {
      return owner.drain.bind(owner);
    },
    get httpOptions() {
      return owner.httpOptions.bind(owner);
    },
    get begin() {
      return owner.begin.bind(owner);
    },
    get bytes() {
      return owner.bytes.bind(owner);
    },
    get json() {
      return owner.json.bind(owner);
    },
    get read() {
      return owner.read.bind(owner);
    },
    get sources() {
      return owner.sources.bind(owner);
    },
    get business() {
      return owner.business.bind(owner);
    },
    get held() {
      return owner.held.bind(owner);
    },
    get checkFreshPublication() {
      return owner.checkFreshPublication.bind(owner);
    },
    get transport() {
      return owner.transport.bind(owner);
    },
    get confirm() {
      return owner.confirm.bind(owner);
    },
    get callback() {
      return owner.callback.bind(owner);
    },
    get post() {
      return owner.post.bind(owner);
    },
    get run() {
      return owner.run.bind(owner);
    },
    get borrowed() {
      return owner.borrowed;
    },
    set borrowed(value) {
      owner.borrowed = value;
    },
    get workId() {
      return owner.workId;
    },
    set workId(value) {
      owner.workId = value;
    },
  };
  return {
    ...createOwnedNativeShortSubmissionRunLifecycle(deps, globals),
    ...createOwnedNativeShortSubmissionRunTransport(deps, globals),
    ...createOwnedNativeShortSubmissionRunReceipts(deps, globals),
    ...createOwnedNativeShortSubmissionRunRun(deps, globals),
  };
}
