import { type FixtureRun, type OwnedStopSignal } from '../short-native-body-api.js';

import {
  type NativeShortBodyFixtureApiResult,
  type NativeShortBodyApiOptions,
  type Factory,
  type NativeShortBodyApiReason,
  type NativeShortBodyApiResult,
  type NativeShortBodyDurableApiResult,
} from './signal-aborted.js';

import { type APIRequestContext, type APIResponse, type BrowserContext } from 'playwright';

import {
  type NativeShortBodyBusinessInput,
  type NativeShortBodySnapshot,
  type NativeShortBodyPlan,
} from '../short-native-body.js';

import {
  type NativeShortBodyFixtureTrace,
  type NativeShortBodyRefLink,
  type NativeShortBodyFixtureStageKind,
} from '../short-native-body-proof.js';

import { type NativeShortBodyAuthorityBinding } from '../../runtime/store.js';

import { type NativeShortFixedReadKind } from '../short-native-metadata-api.js';

export interface FixtureRunOwner {
  owner: FixtureRun;
  result: NativeShortBodyFixtureApiResult;
  options: NativeShortBodyApiOptions | null;
  factory: Factory | null;
  reason:
    | 'context_unavailable'
    | 'identity_unverified'
    | 'owner_changed'
    | 'source_changed'
    | 'redirect_blocked'
    | 'response_unverified'
    | 'response_unavailable'
    | 'bounded_unavailable'
    | 'pagination_inconsistent'
    | 'target_unverified'
    | 'unsupported_schema'
    | 'cancelled'
    | 'timeout'
    | 'cleanup_failed'
    | 'lease_unavailable'
    | 'callback_failed'
    | 'production_disabled'
    | 'fixture_not_live'
    | 'invalid_input'
    | 'version_conflict'
    | 'no_change'
    | 'durability_unverified'
    | 'acknowledgement_unverified'
    | 'readback_mismatch'
    | null;
  postReason:
    | 'context_unavailable'
    | 'identity_unverified'
    | 'owner_changed'
    | 'source_changed'
    | 'redirect_blocked'
    | 'response_unverified'
    | 'response_unavailable'
    | 'bounded_unavailable'
    | 'pagination_inconsistent'
    | 'target_unverified'
    | 'unsupported_schema'
    | 'cancelled'
    | 'timeout'
    | 'cleanup_failed'
    | 'lease_unavailable'
    | 'callback_failed'
    | 'production_disabled'
    | 'fixture_not_live'
    | 'invalid_input'
    | 'version_conflict'
    | 'no_change'
    | 'durability_unverified'
    | 'acknowledgement_unverified'
    | 'readback_mismatch'
    | null;
  api: APIRequestContext | null;
  pending: Set<Promise<unknown>>;
  responses: Map<APIResponse<any>, { dispose: Promise<void> | null; disposed: () => void }>;
  disposal: Promise<void> | null;
  cleanupRequested: boolean;
  cleanupResolved: boolean;
  finishCleanup: () => void;
  cleanupDone: Promise<void>;
  notifyStop: () => void;
  stopped: Promise<OwnedStopSignal>;
  started: boolean;
  timer: NodeJS.Timeout | undefined;
  business: NativeShortBodyBusinessInput | null;
  trace: NativeShortBodyFixtureTrace | null;
  noChange: boolean;
  ownerCheckedAt: string | null;
  persisted: boolean;
  attemptBoundaryEntered: boolean;
  committedAttemptRecoveryFailed: boolean;
  links: Record<
    'preSave' | 'after' | 'baseline' | 'intent' | 'attempt' | 'acknowledgement',
    NativeShortBodyRefLink | null
  >;
  borrowed: BrowserContext;
  workId: string;
  binding: NativeShortBodyAuthorityBinding | null;
  track: <T>(promise: Promise<T>) => Promise<T>;
  wait: <T>(promise: Promise<T>) => Promise<T>;
  fail: (reason: NativeShortBodyApiReason) => never;
  stop: (reason?: NativeShortBodyApiReason) => void;
  quarantine: () => void;
  disposalFailed: () => void;
  check: () => void;
  ownResponse: (response: APIResponse, disposed: () => void) => APIResponse;
  disposeResponse: (response: APIResponse) => Promise<void>;
  drain: () => void;
  decode: (response: APIResponse, url: string) => Promise<Record<string, unknown>>;
  json: (
    name: 'before' | 'preSave' | 'after',
    kind: NativeShortFixedReadKind,
    listIndex?: number,
  ) => Promise<Record<string, unknown>>;
  read: (name: 'before' | 'preSave' | 'after') => Promise<NativeShortBodySnapshot>;
  emit: (
    kind: NativeShortBodyFixtureStageKind,
    payload: Readonly<Record<string, unknown>>,
    eventAt?: string,
    observe?: boolean,
  ) => Promise<void>;
  ack: (root: Record<string, unknown>, before: NativeShortBodySnapshot) => void;
  post: (plan: NativeShortBodyPlan, before: NativeShortBodySnapshot) => Promise<void>;
  snapshotResult: () => NativeShortBodyApiResult;
  run: () => Promise<NativeShortBodyApiResult>;
  durableResult: (
    clean: boolean,
    failed: NativeShortBodyApiReason | null,
  ) => NativeShortBodyDurableApiResult;
}

export type FixtureRunOperations = Pick<
  FixtureRunOwner,
  | 'track'
  | 'wait'
  | 'fail'
  | 'stop'
  | 'quarantine'
  | 'disposalFailed'
  | 'check'
  | 'ownResponse'
  | 'disposeResponse'
  | 'drain'
  | 'decode'
  | 'json'
  | 'read'
  | 'emit'
  | 'ack'
  | 'post'
  | 'snapshotResult'
  | 'run'
  | 'durableResult'
>;
