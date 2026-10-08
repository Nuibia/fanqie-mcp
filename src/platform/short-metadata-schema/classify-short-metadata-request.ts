import { SHORT_METADATA_ASSETS } from './short_metadata_assets.js';

import {
  shortMetadataDocument,
  OWN,
  isShortMetadataEditUrl,
  type ShortMetadataReason,
  type ShortMetadataResult,
  type SchemaType,
  type ShortMetadataOptions,
} from './object.js';

import { OwnedShortMetadataRun } from '../short-metadata-schema.js';

import {
  type BrowserContext,
  type Page,
  type CDPSession,
  type Request,
  type Browser,
  type Response,
  type Route,
} from 'playwright';

const ASSETS = new Map<string, string>(SHORT_METADATA_ASSETS);

// One audited public SDK alias. The wire URL is never an independent permission.
export const SHORT_METADATA_STATIC_ALIAS = Object.freeze({
  source: 'https://privacy.zijieapi.com/api/web-cmp/sdk/?project_key=80b920d966da0f81',
  wire: 'https://lf9-sec.bytetos.com/obj/cookie-project-sdk/cmp.25_667beaj9.js',
});

export function classifyShortMetadataRequest(
  raw: string,
  method: string,
  resourceType: string,
  navigation: boolean,
  workId: string,
): 'document' | 'own' | 'edit' | 'static' | 'deny' {
  if (method !== 'GET') return 'deny';
  if (raw === shortMetadataDocument(workId) && resourceType === 'document' && navigation)
    return 'document';
  if (navigation) return 'deny';
  if (raw === OWN && ['xhr', 'fetch'].includes(resourceType)) return 'own';
  if (isShortMetadataEditUrl(raw, workId) && ['xhr', 'fetch'].includes(resourceType)) return 'edit';
  return ASSETS.get(raw) === resourceType ? 'static' : 'deny';
}

export function unavailableShortMetadata(reason: ShortMetadataReason): ShortMetadataResult {
  return {
    schema: 'short-metadata-schema/v1',
    status: 'capability_unavailable',
    reason,
    fields: null,
    unknownKeyCount: null,
    unknownKeysTruncated: false,
    proof: {
      platformStarted: false,
      ownerBefore: false,
      ownerAfter: false,
      ownerCallback: false,
      rootCommitted: false,
      uniqueNaturalResponse: false,
      connectedBarrier: false,
      proofCapturedAt: null,
      atomicRevision: false,
    },
    own: { attempts: 0, disposed: 0 },
    blocked: {
      nonGet: 0,
      unknownGet: 0,
      foreignFrame: 0,
      webSocket: 0,
      serviceWorker: 0,
      redirect: 0,
      protocolFailure: 0,
    },
    cleanup: {
      contextCreated: false,
      contextClosed: false,
      apiDisposed: false,
      pendingAtEnd: 0,
      checkedAt: new Date().toISOString(),
    },
  };
}

/** One job owns every fresh handle. Construct/register synchronously before the first await. */
export interface OwnedShortMetadataRunOwner {
  owner: OwnedShortMetadataRun;
  result: ShortMetadataResult;
  reason: ShortMetadataReason | null;
  fresh: BrowserContext | null;
  page: Page | null;
  cdp: CDPSession | null;
  closing: Promise<void> | null;
  ending: boolean;
  closed: boolean;
  connected: boolean;
  wake: (() => void) | null;
  pending: Set<Promise<unknown>>;
  allowed: WeakSet<Request>;
  requests: Set<Request>;
  aliasRequests: Set<Request>;
  alias: {
    request: Request;
    networkId: string;
    routeAck: boolean;
    responseSeen: boolean;
    fetchSeen: boolean;
    fetchAck: boolean;
  } | null;
  network: Map<
    string,
    { url: string; method: string; type: string; loader: string; frame: string; allowed: boolean }
  >;
  pauses: Set<string>;
  initialFrame: { id: string; loaderId: string } | null;
  root: string;
  loader: string;
  documentLoader: string;
  committed: boolean;
  navigating: boolean;
  documentRequests: number;
  candidateCount: number;
  observation: {
    fields: {
      field: 'category' | 'thumb_uri' | 'thumb_url_list' | 'book_thumb_uri' | 'book_thumb_url_list';
      present: boolean;
      type: SchemaType;
      arrayCount: number | null;
      truncated: boolean;
      categorySamples: {
        type: SchemaType;
        fields: { field: 'category_id' | 'label' | 'name'; type: SchemaType }[];
      }[];
    }[];
    unknownKeyCount: number;
    unknownKeysTruncated: boolean;
  } | null;
  unregister: (() => void)[];
  timer: NodeJS.Timeout | undefined;
  borrowed: BrowserContext;
  browser: Browser;
  workId: string;
  options: ShortMetadataOptions;
  track: <T>(promise: Promise<T>) => Promise<T>;
  check: () => void;
  stop: (reason?: ShortMetadataReason) => void;
  startClose: () => void;
  listen: (
    target: { on: Function; off: Function },
    event: string,
    handler: (...args: any[]) => void,
  ) => void;
  failProtocol: () => void;
  closeTerminal: (error: unknown) => boolean;
  rejectAsync: (error: unknown) => void;
  eventTask: (action: () => Promise<void>) => void;
  isRootRequest: (request: Request) => boolean;
  networkKind: (type: string) => string;
  sourceRequest: (request: Request) => boolean;
  registerAlias: (request: Request) => boolean;
  aliasResponse: (response: Response, request: Request) => boolean;
  guardRoute: (route: Route, request: Request) => Promise<void>;
  setupNetwork: () => void;
  own: (which: 'ownerBefore' | 'ownerAfter') => Promise<void>;
  acceptResponse: (response: Response) => Promise<void>;
  barrier: () => Promise<void>;
  run: () => Promise<ShortMetadataResult>;
}

export type OwnedShortMetadataRunOperations = Pick<
  OwnedShortMetadataRunOwner,
  | 'track'
  | 'check'
  | 'stop'
  | 'startClose'
  | 'listen'
  | 'failProtocol'
  | 'closeTerminal'
  | 'rejectAsync'
  | 'eventTask'
  | 'isRootRequest'
  | 'networkKind'
  | 'sourceRequest'
  | 'registerAlias'
  | 'aliasResponse'
  | 'guardRoute'
  | 'setupNetwork'
  | 'own'
  | 'acceptResponse'
  | 'barrier'
  | 'run'
>;
