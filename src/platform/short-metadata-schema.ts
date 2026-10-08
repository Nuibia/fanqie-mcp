import {
  bounded,
  isShortMetadataEditUrl,
  shortMetadataDocument,
  OWN,
  object,
  projectShortMetadataFields,
  ORIGIN,
  type ShortMetadataReason,
  type ShortMetadataOptions,
  type ShortMetadataResult,
} from './short-metadata-schema/object.js';

import {
  SHORT_METADATA_STATIC_ALIAS,
  classifyShortMetadataRequest,
  type OwnedShortMetadataRunOperations,
  unavailableShortMetadata,
  type OwnedShortMetadataRunOwner,
} from './short-metadata-schema/classify-short-metadata-request.js';

import {
  type BrowserContext,
  type Page,
  type CDPSession,
  type Request,
  type Browser,
  type Response,
  type Route,
} from 'playwright';

import { composeOwnedShortMetadataRun } from './short-metadata-schema/compose.js';

export interface OwnedShortMetadataRunGlobals {
  bounded: typeof bounded;
  isShortMetadataEditUrl: typeof isShortMetadataEditUrl;
  shortMetadataDocument: typeof shortMetadataDocument;
  SHORT_METADATA_STATIC_ALIAS: typeof SHORT_METADATA_STATIC_ALIAS;
  classifyShortMetadataRequest: typeof classifyShortMetadataRequest;
  OWN: typeof OWN;
  object: typeof object;
  projectShortMetadataFields: typeof projectShortMetadataFields;
  ORIGIN: typeof ORIGIN;
}

export class OwnedShortMetadataRun {
  #operations: OwnedShortMetadataRunOperations;

  readonly result = unavailableShortMetadata('response_unavailable');

  private reason: ShortMetadataReason | null = null;

  private fresh: BrowserContext | null = null;

  private page: Page | null = null;

  private cdp: CDPSession | null = null;

  private closing: Promise<void> | null = null;

  private ending = false;

  private closed = false;

  private connected = false;

  private wake: (() => void) | null = null;

  private readonly pending = new Set<Promise<unknown>>();

  private readonly allowed = new WeakSet<Request>();

  private readonly requests = new Set<Request>();

  private readonly aliasRequests = new Set<Request>();

  private alias: {
    request: Request;
    networkId: string;
    routeAck: boolean;
    responseSeen: boolean;
    fetchSeen: boolean;
    fetchAck: boolean;
  } | null = null;

  private readonly network = new Map<
    string,
    { url: string; method: string; type: string; loader: string; frame: string; allowed: boolean }
  >();

  private readonly pauses = new Set<string>();

  private initialFrame: { id: string; loaderId: string } | null = null;

  private root = '';

  private loader = '';

  private documentLoader = '';

  private committed = false;

  private navigating = false;

  private documentRequests = 0;

  private candidateCount = 0;

  private observation: ReturnType<typeof projectShortMetadataFields> | null = null;

  private unregister: Array<() => void> = [];

  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly borrowed: BrowserContext,
    private readonly browser: Browser,
    private readonly workId: string,
    private readonly options: ShortMetadataOptions,
  ) {
    this.#operations = composeOwnedShortMetadataRun(
      this as unknown as OwnedShortMetadataRunOwner,
      this,
      {
        bounded,
        isShortMetadataEditUrl,
        shortMetadataDocument,
        SHORT_METADATA_STATIC_ALIAS,
        classifyShortMetadataRequest,
        OWN,
        object,
        projectShortMetadataFields,
        ORIGIN,
      },
    );
  }
  private track<T>(promise: Promise<T>): Promise<T> {
    return this.#operations.track(promise);
  }
  private check(): void {
    return this.#operations.check();
  }
  stop(reason: ShortMetadataReason = 'cancelled'): void {
    return this.#operations.stop(reason);
  }
  private startClose(): void {
    return this.#operations.startClose();
  }
  private listen(
    target: { on: Function; off: Function },
    event: string,
    handler: (...args: any[]) => void,
  ): void {
    return this.#operations.listen(target, event, handler);
  }
  private failProtocol(): void {
    return this.#operations.failProtocol();
  }
  private closeTerminal(error: unknown): boolean {
    return this.#operations.closeTerminal(error);
  }
  private rejectAsync(error: unknown): void {
    return this.#operations.rejectAsync(error);
  }
  private eventTask(action: () => Promise<void>): void {
    return this.#operations.eventTask(action);
  }
  private isRootRequest(request: Request): boolean {
    return this.#operations.isRootRequest(request);
  }
  private networkKind(type: string): string {
    return this.#operations.networkKind(type);
  }
  private sourceRequest(request: Request): boolean {
    return this.#operations.sourceRequest(request);
  }
  private registerAlias(request: Request): boolean {
    return this.#operations.registerAlias(request);
  }
  private aliasResponse(response: Response, request: Request): boolean {
    return this.#operations.aliasResponse(response, request);
  }
  private guardRoute(route: Route, request: Request): Promise<void> {
    return this.#operations.guardRoute(route, request);
  }
  private setupNetwork(): void {
    return this.#operations.setupNetwork();
  }
  private own(which: 'ownerBefore' | 'ownerAfter'): Promise<void> {
    return this.#operations.own(which);
  }
  private acceptResponse(response: Response): Promise<void> {
    return this.#operations.acceptResponse(response);
  }
  private barrier(): Promise<void> {
    return this.#operations.barrier();
  }
  run(): Promise<ShortMetadataResult> {
    return this.#operations.run();
  }
}
export { SHORT_METADATA_FIELDS } from './short-metadata-schema/object.js';
export type { SchemaType } from './short-metadata-schema/object.js';
export type { ShortMetadataReason } from './short-metadata-schema/object.js';
export type { ShortMetadataField } from './short-metadata-schema/object.js';
export type { ShortMetadataResult } from './short-metadata-schema/object.js';
export type { ShortMetadataOptions } from './short-metadata-schema/object.js';
export { projectShortMetadataFields } from './short-metadata-schema/object.js';
export { shortMetadataDocument } from './short-metadata-schema/object.js';
export { isShortMetadataEditUrl } from './short-metadata-schema/object.js';
export { SHORT_METADATA_ASSETS } from './short-metadata-schema/short_metadata_assets.js';
export { SHORT_METADATA_STATIC_ALIAS } from './short-metadata-schema/classify-short-metadata-request.js';
export { classifyShortMetadataRequest } from './short-metadata-schema/classify-short-metadata-request.js';
export { unavailableShortMetadata } from './short-metadata-schema/classify-short-metadata-request.js';
export type { OwnedShortMetadataRunOwner } from './short-metadata-schema/classify-short-metadata-request.js';
export type { OwnedShortMetadataRunOperations } from './short-metadata-schema/classify-short-metadata-request.js';
export { safeShortMetadataResult } from './short-metadata-schema/safe-short-metadata-result.js';
