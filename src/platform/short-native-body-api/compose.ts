import {
  type FixtureRunOwner,
  type FixtureRunGlobals,
  type FixtureRunOperations,
  type FixtureRun,
} from '../short-native-body-api.js';
import { createFixtureRunLifecycle } from './lifecycle.js';
import { createFixtureRunTransport } from './transport.js';
import { createFixtureRunReceipts } from './receipts.js';
import { createFixtureRunRun } from './run.js';
import { createFixtureRunDurableResult } from './durable-result.js';
export function composeFixtureRun(
  owner: FixtureRunOwner,
  identity: FixtureRun,
  globals: FixtureRunGlobals,
): FixtureRunOperations {
  const deps: FixtureRunOwner = {
    owner: identity,
    get result() {
      return owner.result;
    },
    set result(value) {
      owner.result = value;
    },
    get options() {
      return owner.options;
    },
    set options(value) {
      owner.options = value;
    },
    get factory() {
      return owner.factory;
    },
    set factory(value) {
      owner.factory = value;
    },
    get reason() {
      return owner.reason;
    },
    set reason(value) {
      owner.reason = value;
    },
    get postReason() {
      return owner.postReason;
    },
    set postReason(value) {
      owner.postReason = value;
    },
    get api() {
      return owner.api;
    },
    set api(value) {
      owner.api = value;
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
    get disposal() {
      return owner.disposal;
    },
    set disposal(value) {
      owner.disposal = value;
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
    get notifyStop() {
      return owner.notifyStop;
    },
    set notifyStop(value) {
      owner.notifyStop = value;
    },
    get stopped() {
      return owner.stopped;
    },
    set stopped(value) {
      owner.stopped = value;
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
    get business() {
      return owner.business;
    },
    set business(value) {
      owner.business = value;
    },
    get trace() {
      return owner.trace;
    },
    set trace(value) {
      owner.trace = value;
    },
    get noChange() {
      return owner.noChange;
    },
    set noChange(value) {
      owner.noChange = value;
    },
    get ownerCheckedAt() {
      return owner.ownerCheckedAt;
    },
    set ownerCheckedAt(value) {
      owner.ownerCheckedAt = value;
    },
    get persisted() {
      return owner.persisted;
    },
    set persisted(value) {
      owner.persisted = value;
    },
    get attemptBoundaryEntered() {
      return owner.attemptBoundaryEntered;
    },
    set attemptBoundaryEntered(value) {
      owner.attemptBoundaryEntered = value;
    },
    get committedAttemptRecoveryFailed() {
      return owner.committedAttemptRecoveryFailed;
    },
    set committedAttemptRecoveryFailed(value) {
      owner.committedAttemptRecoveryFailed = value;
    },
    get links() {
      return owner.links;
    },
    set links(value) {
      owner.links = value;
    },
    get track() {
      return owner.track.bind(owner);
    },
    get wait() {
      return owner.wait.bind(owner);
    },
    get fail() {
      return owner.fail.bind(owner);
    },
    get stop() {
      return owner.stop.bind(owner);
    },
    get quarantine() {
      return owner.quarantine.bind(owner);
    },
    get disposalFailed() {
      return owner.disposalFailed.bind(owner);
    },
    get check() {
      return owner.check.bind(owner);
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
    get decode() {
      return owner.decode.bind(owner);
    },
    get json() {
      return owner.json.bind(owner);
    },
    get read() {
      return owner.read.bind(owner);
    },
    get emit() {
      return owner.emit.bind(owner);
    },
    get ack() {
      return owner.ack.bind(owner);
    },
    get post() {
      return owner.post.bind(owner);
    },
    get snapshotResult() {
      return owner.snapshotResult.bind(owner);
    },
    get run() {
      return owner.run.bind(owner);
    },
    get durableResult() {
      return owner.durableResult.bind(owner);
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
    get binding() {
      return owner.binding;
    },
    set binding(value) {
      owner.binding = value;
    },
  };
  return {
    ...createFixtureRunLifecycle(deps, globals),
    ...createFixtureRunTransport(deps, globals),
    ...createFixtureRunReceipts(deps, globals),
    ...createFixtureRunRun(deps, globals),
    ...createFixtureRunDurableResult(deps, globals),
  };
}
