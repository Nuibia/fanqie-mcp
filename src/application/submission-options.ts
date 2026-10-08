import { type NativeShortProvenance } from '../platform/short-native-metadata-proof.js';
import { type Config } from '../config.js';
import { type LoginState } from '../platform/browser.js';
import { type SubmissionOptionsOperation } from './contracts/maintenance.js';
import { type NativeBoundAccountOperation } from './contracts/capabilities.js';
import { type BindIdentityOperation } from './contracts/identity.js';
interface Dependencies {
  config: Config;
  nativeProvenance: NativeShortProvenance;
  nativeBoundAccount: NativeBoundAccountOperation;
  bindIdentity: BindIdentityOperation;
  login: LoginState | null;
}

export function createSubmissionOptions(deps: Dependencies): SubmissionOptionsOperation {
  function submissionOptions(expectedPlatformAccount: string) {
    return {
      timeoutMs: deps.config.timeoutMs,
      expectedPlatformAccount,
      provenance: deps.nativeProvenance,
      currentPlatformAccount: deps.nativeBoundAccount,
      onVerifiedAccount: (accountId: string, checkedAt: string) => {
        const state: LoginState = {
          status: 'authenticated',
          identity: {
            accountId,
            authorId: null,
            displayName: null,
            evidenceSource: 'https://fanqienovel.com/api/user/info/v2',
          },
          sourceUrl: 'https://fanqienovel.com/api/user/info/v2',
          checkedAt,
        };
        deps.bindIdentity(state);
        deps.login = state;
      },
    };
  }
  return submissionOptions;
}
