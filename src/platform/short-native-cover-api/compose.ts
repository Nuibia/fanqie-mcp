import {
  type OwnedNativeShortCoverRunOwner,
  type OwnedNativeShortCoverRunGlobals,
  type OwnedNativeShortCoverRunOperations,
  type OwnedNativeShortCoverRun,
} from '../short-native-cover-api.js';
import { createOwnedNativeShortCoverRunLifecycle } from './lifecycle.js';
import { createOwnedNativeShortCoverRunTransport } from './transport.js';
import { createOwnedNativeShortCoverRunReceipts } from './receipts.js';
import { createOwnedNativeShortCoverRunRun } from './run.js';
export function composeOwnedNativeShortCoverRun(
  owner: OwnedNativeShortCoverRunOwner,
  identity: OwnedNativeShortCoverRun,
  globals: OwnedNativeShortCoverRunGlobals,
): OwnedNativeShortCoverRunOperations {
  const deps: OwnedNativeShortCoverRunOwner = {
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
    get businessRequest() {
      return owner.businessRequest;
    },
    set businessRequest(value) {
      owner.businessRequest = value;
    },
    get optionsValid() {
      return owner.optionsValid;
    },
    set optionsValid(value) {
      owner.optionsValid = value;
    },
    get reason() {
      return owner.reason;
    },
    set reason(value) {
      owner.reason = value;
    },
    get api() {
      return owner.api;
    },
    set api(value) {
      owner.api = value;
    },
    get disposing() {
      return owner.disposing;
    },
    set disposing(value) {
      owner.disposing = value;
    },
    get pending() {
      return owner.pending;
    },
    set pending(value) {
      owner.pending = value;
    },
    get imageAbortController() {
      return owner.imageAbortController;
    },
    set imageAbortController(value) {
      owner.imageAbortController = value;
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
    get refs() {
      return owner.refs;
    },
    set refs(value) {
      owner.refs = value;
    },
    get receiptIdentity() {
      return owner.receiptIdentity;
    },
    set receiptIdentity(value) {
      owner.receiptIdentity = value;
    },
    get activeConfirmation() {
      return owner.activeConfirmation;
    },
    set activeConfirmation(value) {
      owner.activeConfirmation = value;
    },
    get copiedBytes() {
      return owner.copiedBytes;
    },
    set copiedBytes(value) {
      owner.copiedBytes = value;
    },
    get timer() {
      return owner.timer;
    },
    set timer(value) {
      owner.timer = value;
    },
    get started() {
      return owner.started;
    },
    set started(value) {
      owner.started = value;
    },
    get track() {
      return owner.track.bind(owner);
    },
    get stop() {
      return owner.stop.bind(owner);
    },
    get disposalFailed() {
      return owner.disposalFailed.bind(owner);
    },
    get startDispose() {
      return owner.startDispose.bind(owner);
    },
    get check() {
      return owner.check.bind(owner);
    },
    get fail() {
      return owner.fail.bind(owner);
    },
    get transport() {
      return owner.transport.bind(owner);
    },
    get responseJson() {
      return owner.responseJson.bind(owner);
    },
    get json() {
      return owner.json.bind(owner);
    },
    get httpOptions() {
      return owner.httpOptions.bind(owner);
    },
    get read() {
      return owner.read.bind(owner);
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
    get held() {
      return owner.held.bind(owner);
    },
    get observation() {
      return owner.observation.bind(owner);
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
    get factory() {
      return owner.factory;
    },
    set factory(value) {
      owner.factory = value;
    },
    get preparer() {
      return owner.preparer;
    },
    set preparer(value) {
      owner.preparer = value;
    },
  };
  return {
    ...createOwnedNativeShortCoverRunLifecycle(deps, globals),
    ...createOwnedNativeShortCoverRunTransport(deps, globals),
    ...createOwnedNativeShortCoverRunReceipts(deps, globals),
    ...createOwnedNativeShortCoverRunRun(deps, globals),
  };
}
