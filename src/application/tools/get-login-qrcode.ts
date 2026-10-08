import { createHash, randomUUID } from 'node:crypto';
import { type Config } from '../../config.js';
import { JobQueue } from '../../runtime/jobs.js';
import { readLoginFallback } from '../../runtime/login-fallback.js';
import { BrowserSession, type LoginState, type LoginQrcodeResult } from '../../platform/browser.js';
import { datasets, empty, hash, jsonValue } from '../shared.js';
import { type ToolOperation } from '../contracts/tool-input.js';
import { type WaitOperation } from '../contracts/query.js';
import { type BindIdentityOperation } from '../contracts/identity.js';
interface Dependencies {
  tool: ToolOperation;
  wait: WaitOperation;
  queue: JobQueue;
  config: Config;
  browser: BrowserSession;
  login: LoginState | null;
  bindIdentity: BindIdentityOperation;
}

export function registerGetLoginQrcodeTool(deps: Dependencies): void {
  deps.tool(
    'get_login_qrcode',
    '读取番茄当前扫码登录二维码，返回原生图片供本人使用平台提示的App扫码；检查状态不会刷新扫码页面。二维码仅本次响应，不保存或历史回放；过期后重新请求。',
    empty,
    true,
    async () => {
      let current: LoginQrcodeResult | undefined;
      // QR bytes belong to this request only. Disable queued read merging so a
      // second caller cannot accidentally return metadata without its own image.
      const result = await deps.wait(
        deps.queue.enqueueRead({
          accountId: deps.config.accountId,
          operation: 'get_login_qrcode',
          scope: 'login_qrcode',
          datasets: ['login_qrcode'],
          inputHash: hash(randomUUID()),
          run: async (ctx) => {
            ctx.beforePlatformRead();
            current = await deps.browser.getLoginQrcode({ signal: ctx.signal });
            deps.login = current.login;
            deps.bindIdentity(deps.login);
            const image = current.status === 'ready' ? current.image : undefined;
            const metadata = {
              status: current.status,
              login: current.login,
              checkedAt: current.checkedAt,
              sourceUrl: current.sourceUrl,
              platform: current.platform,
              appInstructions: current.appInstructions,
              expiry: current.expiry,
            };
            return [
              ctx.saveEvidence(
                'login_qrcode',
                jsonValue({
                  ...metadata,
                  ...(current.status === 'ready'
                    ? { qrVerified: current.qrVerified, mimeType: current.mimeType }
                    : { reason: current.reason }),
                  ...(image
                    ? {
                        imageSha256: createHash('sha256').update(image).digest('hex'),
                        imageSize: image.length,
                      }
                    : {}),
                }),
              ),
            ];
          },
        }),
      );
      const state = result.data[0] ?? null;
      const loginFallback = readLoginFallback(deps.config.loginFallback);
      // Cancellation/failure must never release even a valid image captured
      // before the durable job settled unsuccessfully.
      return {
        ...result,
        qrcode: state,
        ...(result.job?.status === 'succeeded' && current?.status === 'ready' && current.image
          ? { image: { mimeType: 'image/png', data: current.image.toString('base64') } }
          : {}),
        nextCheckTool: 'fanqie_check_login_status',
        loginFallback,
        ...(loginFallback.status === 'available'
          ? { fallbackManagementUrl: 'http://127.0.0.1:18063/vnc.html' }
          : {}),
      };
    },
    'image',
  );
}
