import { type BrowserContext } from 'playwright';
import {
  type OwnedShortMetadataRunOwner,
  type OwnedShortMetadataRunGlobals,
} from '../short-metadata-schema.js';
export function createOwnedShortMetadataRunTransport(
  deps: Pick<
    OwnedShortMetadataRunOwner,
    'check' | 'result' | 'options' | 'track' | 'fresh' | 'stop'
  >,
  globals: Pick<OwnedShortMetadataRunGlobals, 'OWN' | 'object'>,
) {
  async function own(which: 'ownerBefore' | 'ownerAfter'): Promise<void> {
    deps.check();
    if (!deps.result.proof.platformStarted) {
      deps.options.onBeforePlatformRead();
      deps.result.proof.platformStarted = true;
    }
    deps.result.own.attempts++;
    let response: Awaited<ReturnType<BrowserContext['request']['get']>> | null = null;
    try {
      response = await deps.track(
        deps.fresh!.request.get(globals.OWN, {
          maxRedirects: 0,
          maxRetries: 0,
          timeout: Math.max(1, deps.options.deadline - performance.now()),
          failOnStatusCode: false,
        }),
      );
      deps.check();
      if (response.url() !== globals.OWN || response.status() < 200 || response.status() >= 300) {
        deps.stop('identity_unverified');
        throw new Error();
      }
      const bytes = await deps.track(response.body());
      deps.check();
      if (bytes.length > 3_000_000) {
        deps.stop('identity_unverified');
        throw new Error();
      }
      const envelope = globals.object(JSON.parse(bytes.toString('utf8'))),
        data = globals.object(envelope?.data);
      if (envelope?.code !== 0 || typeof data?.id !== 'string' || !/^\d{1,30}$/.test(data.id)) {
        deps.stop('identity_unverified');
        throw new Error();
      }
      if (data.id !== deps.options.expectedAccountId) {
        deps.stop('owner_changed');
        throw new Error();
      }
      deps.result.proof[which] = true;
    } finally {
      if (response) {
        try {
          await deps.track(response.dispose());
          deps.result.own.disposed++;
        } catch {
          deps.stop('cleanup_failed');
          throw new Error('Account response disposal failed');
        }
      }
    }
    deps.check();
  }
  return { own };
}
