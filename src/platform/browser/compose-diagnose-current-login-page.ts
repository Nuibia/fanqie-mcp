import { type BrowserOwner } from './owner.js';
import { type BrowserSession } from './session.js';
import { type BrowserOperations } from './operations.js';
import { createDiagnoseCurrentLoginPage } from './operations/diagnose-current-login-page.js';
import { createReadLoginQrUi } from './operations/read-login-qr-ui.js';
import { createGetLoginQrcode } from './operations/get-login-qrcode.js';
import { createScreenshot } from './operations/screenshot.js';
import { createVerifyCurrentAccount } from './operations/verify-current-account.js';
export function composeDiagnoseCurrentLoginPage(
  owner: BrowserOwner,
  session: BrowserSession,
  operations: BrowserOperations,
): void {
  operations.diagnoseCurrentLoginPage = createDiagnoseCurrentLoginPage({
    get withPage() {
      return owner.withPage.bind(owner);
    },
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
    get inspectLogin() {
      return owner.inspectLogin.bind(owner);
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
    get ownInfoUrls() {
      return owner.ownInfoUrls;
    },
    set ownInfoUrls(value) {
      owner.ownInfoUrls = value;
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
  operations.readLoginQrUi = createReadLoginQrUi({});
  operations.getLoginQrcode = createGetLoginQrcode({
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
    get readLoginQrUi() {
      return owner.readLoginQrUi.bind(owner);
    },
  });
  operations.screenshot = createScreenshot({
    get withPage() {
      return owner.withPage.bind(owner);
    },
  });
  operations.verifyCurrentAccount = createVerifyCurrentAccount({
    get assertAccountUsable() {
      return owner.assertAccountUsable.bind(owner);
    },
    get context() {
      return owner.context;
    },
    set context(value) {
      owner.context = value;
    },
    get ownsPageSlot() {
      return owner.ownsPageSlot.bind(owner);
    },
    get withPage() {
      return owner.withPage.bind(owner);
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
    get inspectLogin() {
      return owner.inspectLogin.bind(owner);
    },
    get ownInfoUrls() {
      return owner.ownInfoUrls;
    },
    set ownInfoUrls(value) {
      owner.ownInfoUrls = value;
    },
    get identity() {
      return owner.identity;
    },
    set identity(value) {
      owner.identity = value;
    },
  });
}
