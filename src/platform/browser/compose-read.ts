import { type BrowserOwner } from './owner.js';
import { type BrowserSession } from './session.js';
import { type BrowserOperations } from './operations.js';
import { createRead } from './operations/read.js';
import { createInspectLogin } from './operations/inspect-login.js';
import { createCheckLogin } from './operations/check-login.js';
import { createStartLogin } from './operations/start-login.js';
import { createInspectCurrentLogin } from './operations/inspect-current-login.js';
export function composeRead(
  owner: BrowserOwner,
  session: BrowserSession,
  operations: BrowserOperations,
): void {
  operations.read = createRead({
    get withPage() {
      return owner.withPage.bind(owner);
    },
  });
  operations.inspectLogin = createInspectLogin({
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
    get identity() {
      return owner.identity;
    },
    set identity(value) {
      owner.identity = value;
    },
    get rememberIdentity() {
      return owner.rememberIdentity.bind(owner);
    },
  });
  operations.checkLogin = createCheckLogin({
    get withPage() {
      return owner.withPage.bind(owner);
    },
    get qrLoginPage() {
      return owner.qrLoginPage;
    },
    set qrLoginPage(value) {
      owner.qrLoginPage = value;
    },
    get inspectLogin() {
      return owner.inspectLogin.bind(owner);
    },
    get verifyCurrentAccount() {
      return owner.verifyCurrentAccount.bind(owner);
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
  });
  operations.startLogin = createStartLogin({
    get withPage() {
      return owner.withPage.bind(owner);
    },
    get qrLoginPage() {
      return owner.qrLoginPage;
    },
    set qrLoginPage(value) {
      owner.qrLoginPage = value;
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
    get inspectLogin() {
      return owner.inspectLogin.bind(owner);
    },
    get config() {
      return owner.config;
    },
    set config(value) {
      owner.config = value;
    },
  });
  operations.inspectCurrentLogin = createInspectCurrentLogin({
    get withPage() {
      return owner.withPage.bind(owner);
    },
    get inspectLogin() {
      return owner.inspectLogin.bind(owner);
    },
    get qrLoginPage() {
      return owner.qrLoginPage;
    },
    set qrLoginPage(value) {
      owner.qrLoginPage = value;
    },
  });
}
