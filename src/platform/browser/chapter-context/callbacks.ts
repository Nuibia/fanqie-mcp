import { type Request, type Route } from 'playwright';

import { parseCurrentChapterVolumes } from '../../reads.js';

import {
  type ContextCdpSourceSummary,
  type ContextBlockedRequestStructure,
  type ContextNavigationPhase,
  type ContextNavigationLatches,
  type ContextNavigationState,
  type ContextNavigationTelemetry,
  type ContextNavigationEvent,
} from '../chapter-diagnostics.js';

export interface ChapterReadCallbacks {
  clearTemplates: () => void;
  closeViewWindow: () => void;
  recordCollectionFailureStage: (observedReason?: unknown) => void;
  clearBootstrapSources: () => void;
  settleAborts: () => Promise<void>;
  recordBlocked: (
    request: Request,
    navigation: ContextBlockedRequestStructure['navigation'],
    blockReason: ContextBlockedRequestStructure['blockReason'],
    abortConfirmed: boolean,
    phase: ContextBlockedRequestStructure['phase'],
  ) => void;
  active: () => boolean;
  permittedRoute: (value: string) => boolean;
  navigationPhase: () => ContextNavigationPhase;
  sourceSizes: () => { volume: number; book: number; chapter: number };
  beginSourceObservation: () => boolean;
  appendSourceObservation: (
    event:
      | import('../../reads.js').CurrentChapterSourceRequestObservation
      | import('../../reads.js').CurrentChapterSourceClearObservation,
  ) => void;
  recordSourceClear: (reason: import('../../reads.js').CurrentChapterSourceClearReason) => void;
  recordUnclassifiedSource: () => void;
  recordSourceRequest: (
    value: { url: unknown; method: unknown; type: unknown; frameId: unknown; loaderId: unknown },
    outcome: import('../../reads.js').CurrentChapterSourceOutcome,
  ) => void;
  snapshotSourceObservation: () => import('../../reads.js').CurrentChapterSourceObservation;
  navigationLatches: () => ContextNavigationLatches;
  navigationState: () => ContextNavigationState;
  observeBootstrapInitial: (
    key:
      | 'active'
      | 'sameContext'
      | 'ownedContext'
      | 'currentUrlMatchesAttach'
      | 'noParent'
      | 'frameIdPresent'
      | 'loaderIdPresent'
      | 'noFragment'
      | 'frameUrlMatchesAttach',
    value: boolean,
  ) => boolean;
  observeBootstrapFreeze: (
    key:
      | 'noParent'
      | 'noFragment'
      | 'rootMatches'
      | 'loaderMatches'
      | 'loaderPresent'
      | 'frameUrlMatchesCurrent'
      | 'permittedRoute'
      | 'noPendingNavigation'
      | 'noPendingSameDocument'
      | 'noViolation'
      | 'connected',
    value: boolean,
  ) => boolean;
  snapshotCanonicalBootstrap: () => import('../../reads.js').CurrentChapterCanonicalBootstrapDiagnostic;
  recordNavigation: (event: ContextNavigationEvent) => void;
  recordViolation: (
    reason: NonNullable<ContextNavigationTelemetry['firstViolation']>['reason'],
  ) => void;
  observeRejectedCheck: <T>(
    site: import('../../reads.js').CurrentChapterRejectedCheckSite,
    predicate: import('../../reads.js').CurrentChapterRejectedCheckPredicate,
    value: T,
  ) => T;
  cdpFault: (
    failure: NonNullable<ContextCdpSourceSummary['failure']>,
    fallbackCheck: {
      site: import('../../reads.js').CurrentChapterRejectedCheckSite;
      predicate: import('../../reads.js').CurrentChapterRejectedCheckPredicate;
    },
  ) => void;
  nonempty: (value: unknown) => value is string;
  deferCdp: (callback: () => void) => void;
  acceptBootstrapNavigationEvent: () => boolean;
  cdpStart: (event: {
    frameId: string;
    loaderId: string;
    url: string;
    navigationType: string;
  }) => void;
  cdpCommitted: (event: {
    frame: { id: string; loaderId: string; url: string; parentId?: string; urlFragment?: string };
  }) => void;
  cdpWithinDocument: (event: { frameId: string; url: string }) => void;
  cdpRequest: (event: {
    requestId: string;
    loaderId: string;
    frameId?: string;
    type?: string;
    request: { url: string; method: string };
    redirectResponse?: unknown;
  }) => void;
  cdpFrameDetached: (event: { frameId: string }) => void;
  cdpClosed: () => void;
  observedFences: () => boolean;
  stable: () => boolean;
  assertStable: () => void;
  sourceFamiliesReady: () => boolean;
  sourceFamiliesAmbiguous: () => boolean;
  closeCollectionSourceWindow: () => void;
  openCollectionSourceWindow: () => void;
  canAcquireFrozenCollectionSource: () => boolean;
  acquireCollectionSources: () => Promise<void>;
  onRequest: (request: Request) => void;
  onNavigation: (frame: unknown) => void;
  handleReadOnlyRoute: (route: Route) => Promise<void>;
  readOnlyRoute: (route: Route) => Promise<void>;
  collectManagementViews: (
    volumes: ReturnType<typeof parseCurrentChapterVolumes>,
    initialVolumeId: string,
    initialSource: string,
    read: (source: string) => Promise<unknown>,
  ) => Promise<void>;
}
