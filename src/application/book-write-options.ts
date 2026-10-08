import { type Config } from '../config.js';
import { type JobContext } from '../runtime/jobs.js';
import { BrowserSession } from '../platform/browser.js';
import * as writes from '../platform/writes.js';
import { jsonValue } from './shared.js';
import {
  type BookWriteOptionsOperation,
  type RuntimeTargetOperation,
} from './contracts/maintenance.js';

interface Dependencies {
  writeProfiles:
    | (Partial<Record<'short' | 'chapter', writes.UiWriteProfile>> & {
        'long-book'?: writes.UiLongBookMetadataProfile;
      })
    | undefined;
  config: Config;
  browser: BrowserSession;
  runtimeTarget: RuntimeTargetOperation;
}

export function createBookWriteOptions(deps: Dependencies): BookWriteOptionsOperation {
  function bookWriteOptions(ctx: JobContext): writes.LongBookMetadataOptions {
    return {
      profile: deps.writeProfiles?.['long-book'],
      uploadRoot: deps.config.uploadDir,
      timeoutMs: 20_000,
      verifyAccount: (page) => deps.browser.verifyCurrentAccount(page),
      beforeSideEffect: async (intent) => {
        ctx.saveEvidence(
          'write-intent',
          jsonValue({
            snapshotScope: intent.snapshotScope,
            hashBasis: intent.hashBasis,
            desiredContentHash: intent.desiredContentHash,
            expectedStates: intent.expectedStates.map((state) =>
              state === 'draft' ? 'draft_saved' : state,
            ),
            target: deps.runtimeTarget(intent.target),
          }),
        );
        ctx.recordTarget(deps.runtimeTarget(intent.target));
        ctx.beforePlatformWrite();
      },
    };
  }
  return bookWriteOptions;
}
