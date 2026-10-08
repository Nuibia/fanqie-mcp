import { type Page } from 'playwright';
import { type PlatformIdentity } from '../own-identity.js';
import { BrowserSessionError } from '../errors.js';
import { type BrowserCallOptions, WRITER_HOME } from '../contracts.js';
import {
  type LoginQrcodeResult,
  type LoginQrcodeMetadata,
  parseLoginQrExpiry,
  LOGIN_SCAN_TAB,
  LOGIN_QR_IMAGE,
  verifyQrPng,
  LOGIN_QR_PANEL,
} from '../qr-login.js';
import { type WithPageOperation } from '../contracts/with-page.js';
import { type InspectLoginOperation } from '../contracts/inspect-login.js';
import { type ReadLoginQrUiOperation } from '../contracts/read-login-qr-ui.js';
import { type GetLoginQrcodeOperation } from '../contracts/get-login-qrcode.js';
interface Dependencies {
  withPage: WithPageOperation;
  inspectLogin: InspectLoginOperation;
  qrLoginPage: Page | null;
  identityEpoch: number;
  identity: PlatformIdentity | null;
  readLoginQrUi: ReadLoginQrUiOperation;
}
export function createGetLoginQrcode(deps: Dependencies): GetLoginQrcodeOperation {
  function getLoginQrcode(options: BrowserCallOptions = {}): Promise<LoginQrcodeResult> {
    return deps.withPage(async (page) => {
      try {
        let login = await deps.inspectLogin(page, false);
        const result = (ui: {
          appInstructions: string | null;
          expiryText: string | null;
        }): LoginQrcodeMetadata => {
          let sourceUrl = WRITER_HOME;
          try {
            const url = new URL(page.url());
            if (url.origin === 'https://fanqienovel.com')
              sourceUrl = `${url.origin}${url.pathname}`;
          } catch {
            /* Safe official fallback only. */
          }
          return {
            login,
            checkedAt: new Date().toISOString(),
            sourceUrl,
            platform: 'fanqie',
            appInstructions: ui.appInstructions,
            expiry: parseLoginQrExpiry(ui.expiryText),
          };
        };
        if (login.status === 'authenticated')
          return {
            ...result({ appInstructions: null, expiryText: null }),
            status: 'authenticated',
            reason: 'The service-owned browser is already authenticated',
          };
        deps.qrLoginPage = null;
        deps.identityEpoch += 1;
        deps.identity = null;
        await page.goto(WRITER_HOME, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 4_000 }).catch(() => undefined);
        login = await deps.inspectLogin(page);
        if (login.status === 'authenticated')
          return {
            ...result({ appInstructions: null, expiryText: null }),
            status: 'authenticated',
            reason: 'The service-owned browser is already authenticated',
          };
        let ui = await deps.readLoginQrUi(page);
        if (ui.challenge)
          return {
            ...result(ui),
            status: 'challenge',
            reason: 'The platform requires a person to complete a security challenge',
          };
        const tabs = page.locator(LOGIN_SCAN_TAB).filter({ hasText: /^扫码登录$/ });
        try {
          await tabs.first().waitFor({ state: 'visible', timeout: 15_000 });
        } catch (error) {
          if (page.isClosed()) throw error;
          ui = await deps.readLoginQrUi(page);
          return {
            ...result(ui),
            status: ui.challenge ? 'challenge' : 'unsupported',
            reason: ui.challenge
              ? 'The platform requires a person to complete a security challenge'
              : 'The verified scan-login tab is not visible on this page',
          };
        }
        const visibleTabs = [];
        for (const tab of (await tabs.all()).slice(0, 10))
          if (await tab.isVisible()) visibleTabs.push(tab);
        if (visibleTabs.length !== 1)
          return {
            ...result(ui),
            status: 'unsupported',
            reason: 'The scan-login tab is ambiguous; no login control was clicked',
          };
        await visibleTabs[0]!.click();
        deps.qrLoginPage = page;
        const qrImage = page.locator(LOGIN_QR_IMAGE).first();
        try {
          await qrImage.waitFor({ state: 'visible', timeout: 15_000 });
        } catch (error) {
          if (page.isClosed()) throw error;
          login = await deps.inspectLogin(page);
          if (login.status === 'authenticated') {
            deps.qrLoginPage = null;
            return {
              ...result(ui),
              status: 'authenticated',
              reason: 'Login completed while waiting for the QR image',
            };
          }
          ui = await deps.readLoginQrUi(page);
          return {
            ...result(ui),
            status: ui.challenge ? 'challenge' : ui.expired ? 'expired' : 'unsupported',
            reason: ui.challenge
              ? 'The platform requires a person to complete a security challenge'
              : ui.expired
                ? 'The platform marks the login QR as expired'
                : 'A visible login QR image was not observed',
          };
        }
        await page.waitForFunction(
          (selector) => {
            const image = document.querySelector<HTMLImageElement>(selector);
            return Boolean(image?.complete && image.naturalWidth > 0);
          },
          LOGIN_QR_IMAGE,
          { timeout: 10_000 },
        );
        ui = await deps.readLoginQrUi(page);
        if (ui.challenge || ui.expired)
          return {
            ...result(ui),
            status: ui.challenge ? 'challenge' : 'expired',
            reason: ui.challenge
              ? 'The platform requires a person to complete a security challenge'
              : 'The platform marks the login QR as expired',
          };
        const box = await qrImage.boundingBox();
        if (!box || box.width < 80 || box.height < 80 || box.width > 600 || box.height > 600)
          return {
            ...result(ui),
            status: 'unsupported',
            reason: 'The observed QR image has unexpected display dimensions',
          };
        let image = await qrImage.screenshot({ type: 'png' });
        if (!verifyQrPng(image)) {
          // A small border panel can preserve the QR quiet zone; it contains no phone input or whole-page content.
          const panel = page.locator(LOGIN_QR_PANEL).first();
          const panelBox = await panel.boundingBox();
          if (
            panelBox &&
            panelBox.width >= box.width &&
            panelBox.height >= box.height &&
            panelBox.width <= 650 &&
            panelBox.height <= 650
          )
            image = await panel.screenshot({ type: 'png' });
        }
        if (!verifyQrPng(image))
          return {
            ...result(ui),
            status: 'unsupported',
            reason: 'The login crop could not be verified as a QR code; no image is returned',
          };
        ui = await deps.readLoginQrUi(page);
        if (ui.challenge || ui.expired)
          return {
            ...result(ui),
            status: ui.challenge ? 'challenge' : 'expired',
            reason: ui.challenge
              ? 'The platform requires a person to complete a security challenge'
              : 'The platform marks the login QR as expired',
          };
        login = await deps.inspectLogin(page);
        if (login.status === 'authenticated') {
          deps.qrLoginPage = null;
          return {
            ...result(ui),
            status: 'authenticated',
            reason: 'Login completed while preparing the QR image',
          };
        }
        return { ...result(ui), status: 'ready', image, mimeType: 'image/png', qrVerified: true };
      } catch (error) {
        if (error instanceof BrowserSessionError) throw error;
        // Playwright/codec errors may mention image sources or challenge URLs.
        throw new BrowserSessionError(
          'login_qr_unavailable',
          'Platform login QR preparation failed; no image or session details were returned',
        );
      }
    }, options);
  }
  return getLoginQrcode;
}
