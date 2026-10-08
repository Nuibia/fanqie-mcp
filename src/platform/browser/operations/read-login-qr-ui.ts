import { type Page } from 'playwright';
import { type ReadLoginQrUiOperation } from '../contracts/read-login-qr-ui.js';
interface Dependencies {}
export function createReadLoginQrUi(deps: Dependencies): ReadLoginQrUiOperation {
  async function readLoginQrUi(page: Page): Promise<{
    challenge: boolean;
    expired: boolean;
    appInstructions: string | null;
    expiryText: string | null;
  }> {
    return page.evaluate(() => {
      const visible = (element: Element): boolean => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
          box.width > 0 &&
          box.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0'
        );
      };
      const qr =
        document.querySelector('.slogin-qrcode-scan-page') ??
        document.querySelector('.slogin-qrcode-scan-page__content__code')?.parentElement;
      const text = qr && visible(qr) ? ((qr as HTMLElement).innerText ?? qr.textContent ?? '') : '';
      const challenge = [
        ...document.querySelectorAll(
          '[role="dialog"],[class*="captcha"],[id*="captcha"],[class*="verify"],[id*="verify"]',
        ),
      ]
        .filter(visible)
        .some((element) =>
          /拖动.{0,12}滑块|请完成安全验证|请完成验证|请依次点击|访问异常|操作频繁|安全检测/.test(
            (element as HTMLElement).innerText ?? element.textContent ?? '',
          ),
        );
      const expired = /二维码(?:已)?(?:失效|过期)|扫码(?:已)?(?:失效|过期)|请刷新二维码/.test(text);
      const labels = qr
        ? [
            ...text.split(/\n+/).map((line) => line.trim().replace(/\s+/g, ' ')),
            ...[...qr.querySelectorAll('*')]
              .filter((element) => element.childElementCount === 0 && visible(element))
              .map((element) => element.textContent?.trim().replace(/\s+/g, ' ') ?? ''),
          ]
        : [];
      const appInstructions =
        labels.find(
          (label) =>
            /^(?:番茄作家助手扫码登录|(?:请|使用|打开).{0,60}(?:扫码|扫描|扫一扫).{0,20})$/.test(
              label,
            ) && !/https?:|[A-Za-z0-9_-]{20,}|\d{5,}/.test(label),
        ) ?? null;
      // Only an explicit countdown/duration fragment is serialized; no page prose or image source.
      const expiryText =
        /二维码(?:将)?(?:在)?\s*\d{1,4}\s*(?:秒|分钟)(?:后)?(?:失效|过期)|剩余\s*\d{1,4}\s*(?:秒|分钟)|有效期[:：]?\s*\d{1,4}\s*(?:秒|分钟)/.exec(
          text,
        )?.[0] ?? null;
      return { challenge, expired, appInstructions, expiryText };
    });
  }
  return readLoginQrUi;
}
