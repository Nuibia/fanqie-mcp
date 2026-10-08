import { type LoginState } from '../../platform/browser.js';
import { type JobContext } from '../../runtime/jobs.js';
import { type DatasetResult } from '../../platform/reads.js';
import { AccountBinding } from '../shared.js';
import { type Page } from 'playwright';
export type BindIdentityOperation = (state: LoginState) => void;
export type CheckLoginOperation = (ctx: JobContext) => Promise<LoginState>;
export type CollectedAccountDatasetOperation = (result: DatasetResult<unknown>) => boolean;
export type PersistBindingOperation = (next: AccountBinding) => void;
export type ReadAccountPageOperation = <T>(
  ctx: JobContext,
  read: (page: Page) => Promise<T>,
  verifyResult?: (result: T) => boolean,
) => Promise<T>;
export type RejectBindingOperation = (state: LoginState, error: Error) => never;
export type RequireLoginOperation = (ctx: JobContext) => Promise<LoginState>;
