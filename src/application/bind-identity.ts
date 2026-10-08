import { type Config } from '../config.js';
import { AppError } from '../errors.js';
import { Store, RuntimeError } from '../runtime/store.js';
import { type LoginState } from '../platform/browser.js';
import { AccountBinding } from './shared.js';
import {
  type BindIdentityOperation,
  type RejectBindingOperation,
  type PersistBindingOperation,
} from './contracts/identity.js';

interface Dependencies {
  store: Store;
  rejectBinding: RejectBindingOperation;
  bound: AccountBinding | undefined;
  persistBinding: PersistBindingOperation;
  config: Config;
}

export function createBindIdentity(deps: Dependencies): BindIdentityOperation {
  function bindIdentity(state: LoginState) {
    deps.store.assertPublicReadMutationAllowed();
    if (state.status !== 'authenticated') return;
    const verifiedId = (value: string | null | undefined) =>
      typeof value === 'string' && /^\d{1,30}$/.test(value) ? value : null;
    const accountId = verifiedId(state.identity?.accountId);
    const authorId = verifiedId(state.identity?.authorId);
    if (!accountId && !authorId)
      deps.rejectBinding(
        state,
        new RuntimeError(
          'capability_unavailable',
          'A stable own-account identity is required before binding the service account',
        ),
      );
    try {
      if (deps.bound === undefined) {
        deps.persistBinding({
          accountId: deps.config.accountId,
          platformId: accountId ?? authorId!,
          platformIdType: accountId ? 'account' : 'author',
        });
        return;
      }
      if (
        !deps.bound ||
        typeof deps.bound !== 'object' ||
        typeof deps.bound.accountId !== 'string' ||
        typeof deps.bound.platformId !== 'string' ||
        !/^\d{1,30}$/.test(deps.bound.platformId) ||
        (deps.bound.platformIdType !== undefined &&
          !['account', 'author'].includes(deps.bound.platformIdType))
      ) {
        throw new RuntimeError(
          'invalid_account_binding',
          'The saved account binding does not contain a supported stable identity type and ID',
        );
      }
      if (deps.bound.accountId !== deps.config.accountId)
        throw new AppError(
          'account_mismatch',
          'The browser identity differs from the service account binding',
          409,
        );
      // This deployment's legacy untyped binding was proved through user/info/v2
      // as an account ID. A matching author ID alone cannot prove that namespace.
      const expectedType = deps.bound.platformIdType ?? 'account';
      const currentId = expectedType === 'account' ? accountId : authorId;
      if (!currentId)
        throw new RuntimeError(
          'capability_unavailable',
          'The current platform response does not expose the service binding identity type',
        );
      if (currentId !== deps.bound.platformId)
        throw new AppError(
          'account_mismatch',
          'The browser identity differs from the service account binding',
          409,
        );
      if (deps.bound.platformIdType === undefined)
        deps.persistBinding({
          accountId: deps.bound.accountId,
          platformId: deps.bound.platformId,
          platformIdType: 'account',
        });
    } catch (error) {
      deps.rejectBinding(
        state,
        error instanceof Error
          ? error
          : new RuntimeError(
              'binding_persistence_failed',
              'The verified account binding could not be saved',
            ),
      );
    }
  }
  return bindIdentity;
}
