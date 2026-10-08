import {
  type OwnedShortMetadataRunOwner,
  type OwnedShortMetadataRunGlobals,
  type OwnedShortMetadataRunOperations,
  type OwnedShortMetadataRun,
} from '../short-metadata-schema.js';
import { createOwnedShortMetadataRunLifecycle } from './lifecycle.js';
import { createOwnedShortMetadataRunNetwork } from './network.js';
import { createOwnedShortMetadataRunNetworkSetupNetwork } from './network-setup-network.js';
import { createOwnedShortMetadataRunTransport } from './transport.js';
import { createOwnedShortMetadataRunRun } from './run.js';
export function composeOwnedShortMetadataRun(
  owner: OwnedShortMetadataRunOwner,
  identity: OwnedShortMetadataRun,
  globals: OwnedShortMetadataRunGlobals,
): OwnedShortMetadataRunOperations {
  const deps: OwnedShortMetadataRunOwner = {
    owner: identity,
    get result() {
      return owner.result;
    },
    set result(value) {
      owner.result = value;
    },
    get reason() {
      return owner.reason;
    },
    set reason(value) {
      owner.reason = value;
    },
    get fresh() {
      return owner.fresh;
    },
    set fresh(value) {
      owner.fresh = value;
    },
    get page() {
      return owner.page;
    },
    set page(value) {
      owner.page = value;
    },
    get cdp() {
      return owner.cdp;
    },
    set cdp(value) {
      owner.cdp = value;
    },
    get closing() {
      return owner.closing;
    },
    set closing(value) {
      owner.closing = value;
    },
    get ending() {
      return owner.ending;
    },
    set ending(value) {
      owner.ending = value;
    },
    get closed() {
      return owner.closed;
    },
    set closed(value) {
      owner.closed = value;
    },
    get connected() {
      return owner.connected;
    },
    set connected(value) {
      owner.connected = value;
    },
    get wake() {
      return owner.wake;
    },
    set wake(value) {
      owner.wake = value;
    },
    get pending() {
      return owner.pending;
    },
    set pending(value) {
      owner.pending = value;
    },
    get allowed() {
      return owner.allowed;
    },
    set allowed(value) {
      owner.allowed = value;
    },
    get requests() {
      return owner.requests;
    },
    set requests(value) {
      owner.requests = value;
    },
    get aliasRequests() {
      return owner.aliasRequests;
    },
    set aliasRequests(value) {
      owner.aliasRequests = value;
    },
    get alias() {
      return owner.alias;
    },
    set alias(value) {
      owner.alias = value;
    },
    get network() {
      return owner.network;
    },
    set network(value) {
      owner.network = value;
    },
    get pauses() {
      return owner.pauses;
    },
    set pauses(value) {
      owner.pauses = value;
    },
    get initialFrame() {
      return owner.initialFrame;
    },
    set initialFrame(value) {
      owner.initialFrame = value;
    },
    get root() {
      return owner.root;
    },
    set root(value) {
      owner.root = value;
    },
    get loader() {
      return owner.loader;
    },
    set loader(value) {
      owner.loader = value;
    },
    get documentLoader() {
      return owner.documentLoader;
    },
    set documentLoader(value) {
      owner.documentLoader = value;
    },
    get committed() {
      return owner.committed;
    },
    set committed(value) {
      owner.committed = value;
    },
    get navigating() {
      return owner.navigating;
    },
    set navigating(value) {
      owner.navigating = value;
    },
    get documentRequests() {
      return owner.documentRequests;
    },
    set documentRequests(value) {
      owner.documentRequests = value;
    },
    get candidateCount() {
      return owner.candidateCount;
    },
    set candidateCount(value) {
      owner.candidateCount = value;
    },
    get observation() {
      return owner.observation;
    },
    set observation(value) {
      owner.observation = value;
    },
    get unregister() {
      return owner.unregister;
    },
    set unregister(value) {
      owner.unregister = value;
    },
    get timer() {
      return owner.timer;
    },
    set timer(value) {
      owner.timer = value;
    },
    get track() {
      return owner.track.bind(owner);
    },
    get check() {
      return owner.check.bind(owner);
    },
    get stop() {
      return owner.stop.bind(owner);
    },
    get startClose() {
      return owner.startClose.bind(owner);
    },
    get listen() {
      return owner.listen.bind(owner);
    },
    get failProtocol() {
      return owner.failProtocol.bind(owner);
    },
    get closeTerminal() {
      return owner.closeTerminal.bind(owner);
    },
    get rejectAsync() {
      return owner.rejectAsync.bind(owner);
    },
    get eventTask() {
      return owner.eventTask.bind(owner);
    },
    get isRootRequest() {
      return owner.isRootRequest.bind(owner);
    },
    get networkKind() {
      return owner.networkKind.bind(owner);
    },
    get sourceRequest() {
      return owner.sourceRequest.bind(owner);
    },
    get registerAlias() {
      return owner.registerAlias.bind(owner);
    },
    get aliasResponse() {
      return owner.aliasResponse.bind(owner);
    },
    get guardRoute() {
      return owner.guardRoute.bind(owner);
    },
    get setupNetwork() {
      return owner.setupNetwork.bind(owner);
    },
    get own() {
      return owner.own.bind(owner);
    },
    get acceptResponse() {
      return owner.acceptResponse.bind(owner);
    },
    get barrier() {
      return owner.barrier.bind(owner);
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
    get browser() {
      return owner.browser;
    },
    set browser(value) {
      owner.browser = value;
    },
    get workId() {
      return owner.workId;
    },
    set workId(value) {
      owner.workId = value;
    },
    get options() {
      return owner.options;
    },
    set options(value) {
      owner.options = value;
    },
  };
  return {
    ...createOwnedShortMetadataRunLifecycle(deps, globals),
    ...createOwnedShortMetadataRunNetwork(deps, globals),
    ...createOwnedShortMetadataRunNetworkSetupNetwork(deps, globals),
    ...createOwnedShortMetadataRunTransport(deps, globals),
    ...createOwnedShortMetadataRunRun(deps, globals),
  };
}
