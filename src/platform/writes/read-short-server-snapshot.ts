import { type Page, type Request, type Response } from 'playwright';

import {
  type WriteTarget,
  type UiWriteProfile,
  type WriteOptions,
  type DraftSnapshot,
  type PlatformState,
  type ModernShortSnapshot,
  origin,
  hashDraftContent,
  PlatformWriteError,
} from './hash-draft-content.js';

import {
  type ShortSnapshotMode,
  verifyIdentity,
  assertShortReadTarget,
  boundedPause,
} from './unique.js';

import {
  unavailable,
  shortCaptureRejected,
  shortExact,
  editorUrl,
  validateGenericShortSnapshot,
  isGenericShortCaptureFailure,
  GenericShortCaptureFailure,
} from './is-generic-short-capture-failure.js';

import {
  captureShortStatusJson,
  type ShortStatusFactsV1,
  resolveShortEditorStatus,
} from '../short-status.js';

import { parseShortServerBody } from './parse-short-server-body.js';

export async function readShortServerSnapshot(
  page: Page,
  accountId: string,
  target: WriteTarget,
  profile: UiWriteProfile,
  options: WriteOptions,
  mode: ShortSnapshotMode,
): Promise<DraftSnapshot> {
  if (Object.keys(profile.fields ?? {}).length !== 0)
    unavailable('The native short server source does not establish editable metadata fields.');
  const modern = mode === 'modern_short';
  if (modern) {
    let captured: unknown;
    try {
      captured = captureShortStatusJson(target);
    } catch {
      shortCaptureRejected('The modern short target cannot be captured safely.');
    }
    shortExact(captured, ['kind', 'workId']);
  }
  const readStartedAt = modern ? (options.now?.() ?? new Date()).toISOString() : undefined;
  const profileId = profile.id,
    profileVerifiedAt = profile.verifiedAt;
  const ownerKind = options.identityType ?? ('kind' in profile.identity ? 'account' : undefined);
  const identityOptions = modern
    ? { identityType: ownerKind, verifyAccount: options.verifyAccount, now: options.now }
    : options;
  const deadline = performance.now() + (options.timeoutMs ?? 20_000),
    destination = editorUrl(profile, target);
  const beforeOwner = await verifyIdentity(page, accountId, profile, identityOptions, modern);
  if (performance.now() >= deadline)
    unavailable('The current owner check exceeded the readback deadline.');
  const requests = new Set<Request>();
  let state: PlatformState | undefined,
    statusInput: ModernShortSnapshot['statusInput'] | undefined,
    statusFacts: ShortStatusFactsV1 | undefined;
  let getRequestedAt: string | undefined, getCompletedAt: string | undefined;
  let serverHTML: string | undefined,
    serverTitle: string | undefined,
    invalidObservation = false,
    closed = false,
    responses = 0,
    matchedRequests = 0;
  const match = (raw: string): boolean => {
    try {
      const u = new URL(raw);
      const allowed = new Set([
        'aid',
        'app_name',
        'item_id',
        'image_fmt_list',
        'msToken',
        'a_bogus',
      ]);
      const keys = [...u.searchParams.keys()];
      return (
        u.origin === origin &&
        !u.username &&
        !u.password &&
        !u.hash &&
        u.pathname === '/api/author/short_article/edit/v1/' &&
        keys.every((key) => allowed.has(key)) &&
        new Set(keys).size === keys.length &&
        u.searchParams.getAll('item_id').length === 1 &&
        u.searchParams.get('item_id') === target.workId
      );
    } catch {
      return false;
    }
  };
  const onRequest = (request: Request): void => {
    if (closed) return;
    try {
      if (!match(request.url())) return;
      if (
        request.method() === 'GET' &&
        ['xhr', 'fetch'].includes(request.resourceType()) &&
        request.frame() === page.mainFrame() &&
        page.url() === destination
      ) {
        requests.add(request);
        if (++matchedRequests !== 1 || requests.size !== 1) {
          invalidObservation = true;
          return;
        }
        if (modern) getRequestedAt = (options.now?.() ?? new Date()).toISOString();
      }
    } catch {
      invalidObservation = true;
    }
  };
  const onResponse = (response: Response): void => {
    if (closed) return;
    try {
      const request = response.request();
      if (!requests.has(request)) return;
      if (
        ++responses !== 1 ||
        response.url() !== request.url() ||
        page.url() !== destination ||
        !match(response.url()) ||
        response.status() < 200 ||
        response.status() >= 300
      ) {
        invalidObservation = true;
        return;
      }
      void response.json().then(
        (raw: unknown) => {
          if (closed) return;
          // Capture the entire same response before accessing any field or constructing proof.
          try {
            raw = captureShortStatusJson(raw);
            const envelope =
              raw && typeof raw === 'object' && !Array.isArray(raw)
                ? (raw as Record<string, unknown>)
                : null;
            const data =
              envelope?.data && typeof envelope.data === 'object' && !Array.isArray(envelope.data)
                ? (envelope.data as Record<string, unknown>)
                : null;
            if (
              page.url() !== destination ||
              envelope?.code !== 0 ||
              !data ||
              (data.item_id !== undefined &&
                data.item_id !== target.workId &&
                data.item_id !== '0') ||
              (!modern &&
                (!Number.isInteger(data.publish_status) ||
                  (data.publish_status !== 0 && data.publish_status !== 1)))
            ) {
              invalidObservation = true;
              return;
            }
            if (
              typeof data.content !== 'string' ||
              !Array.isArray(data.multi_title) ||
              data.multi_title.some((title) => typeof title !== 'string') ||
              data.multi_title.length > 10 ||
              data.content.includes('\0') ||
              data.content.length > 3_000_000 ||
              Buffer.byteLength(data.content, 'utf8') > 3_000_000
            ) {
              invalidObservation = true;
              return;
            }
            const title = data.multi_title.length === 0 ? '' : (data.multi_title[0] as string);
            if (
              title.includes('\0') ||
              title.length > 3_000_000 ||
              Buffer.byteLength(title, 'utf8') > 3_000_000
            ) {
              invalidObservation = true;
              return;
            }
            if (modern) {
              statusInput = {};
              for (const key of ['publish_status', 'display_status'] as const)
                if (Object.hasOwn(data, key)) statusInput[key] = data[key];
              statusFacts = resolveShortEditorStatus(statusInput);
            } else {
              const observed = resolveShortEditorStatus(data).resolvedState;
              if (!['draft', 'published', 'reviewing', 'rejected'].includes(observed)) {
                invalidObservation = true;
                return;
              }
              state = observed as PlatformState;
            }
            serverHTML = data.content;
            serverTitle = title;
            if (modern) getCompletedAt = (options.now?.() ?? new Date()).toISOString();
          } catch {
            invalidObservation = true;
          }
        },
        () => {
          if (!closed) invalidObservation = true;
        },
      );
    } catch {
      invalidObservation = true;
    }
  };
  page.on('request', onRequest);
  page.on('response', onResponse);
  try {
    await page.goto(destination, {
      waitUntil: 'domcontentloaded',
      timeout: Math.max(1, deadline - performance.now()),
    });
    assertShortReadTarget(page, profile, target);
    while (serverHTML === undefined && !invalidObservation && performance.now() < deadline) {
      assertShortReadTarget(page, profile, target);
      await boundedPause(deadline);
      assertShortReadTarget(page, profile, target);
    }
    if (invalidObservation && modern)
      shortCaptureRejected(
        'The current native short edit response failed complete raw validation.',
      );
    if (
      invalidObservation ||
      (modern ? !statusFacts : !state) ||
      serverHTML === undefined ||
      serverTitle === undefined ||
      requests.size !== 1 ||
      matchedRequests !== 1 ||
      responses !== 1 ||
      (modern && (!getRequestedAt || !getCompletedAt)) ||
      performance.now() >= deadline
    )
      unavailable(
        'The current native short edit response did not establish verified content and state.',
      );
    let body: string;
    try {
      body = await parseShortServerBody(page, serverHTML);
    } catch (error) {
      if (modern)
        shortCaptureRejected(
          'The current native short edit body failed complete format validation.',
        );
      throw error;
    }
    assertShortReadTarget(page, profile, target);
    const afterOwner = await verifyIdentity(page, accountId, profile, identityOptions, modern);
    assertShortReadTarget(page, profile, target);
    if (
      modern &&
      (options.verifyAccount !== identityOptions.verifyAccount ||
        (options.identityType ?? ('kind' in profile.identity ? 'account' : undefined)) !==
          ownerKind)
    )
      shortCaptureRejected('The modern short typed owner callback changed during readback.');
    if (invalidObservation && modern)
      shortCaptureRejected(
        'The native short edit raw observation changed before complete readback.',
      );
    if (
      invalidObservation ||
      performance.now() >= deadline ||
      profile.id !== profileId ||
      profile.verifiedAt !== profileVerifiedAt
    )
      unavailable('The native short edit observation changed before complete readback.');
    const content = { title: serverTitle, body, metadata: {} },
      platformReadAt = (options.now?.() ?? new Date()).toISOString();
    if (!modern)
      return {
        ...content,
        accountId,
        target,
        state: state!,
        contentHash: hashDraftContent(content),
        sourceUrl: page.url(),
        platformReadAt,
      };
    return validateGenericShortSnapshot({
      ...content,
      accountId,
      target: { kind: 'short', workId: target.workId },
      state: statusFacts!.resolvedState,
      contentHash: hashDraftContent(content),
      sourceUrl: page.url(),
      platformReadAt,
      statusInput,
      statusFacts,
      statusProof: {
        schema: 'fanqie-generic-short-editor-proof/v1',
        profileId,
        profileVerifiedAt,
        profileSource: 'short_article_edit_v1',
        owner: { kind: ownerKind, id: accountId, before: beforeOwner!, after: afterOwner! },
        method: 'GET',
        endpoint: '/api/author/short_article/edit/v1/',
        requestCount: matchedRequests,
        responseCount: responses,
        mainFrame: true,
        fixedSourceVerified: true,
        routeStable: true,
        bodyBound: true,
        readStartedAt,
        getRequestedAt,
        getCompletedAt,
        readFinishedAt: platformReadAt,
      },
    });
  } catch (error) {
    // Once actual raw content exists, a lost owner/route/deadline/proof is a sticky capture failure.
    if (
      modern &&
      (serverHTML !== undefined || invalidObservation) &&
      !isGenericShortCaptureFailure(error)
    )
      throw new GenericShortCaptureFailure(
        error instanceof Error ? error.message : 'The modern short read lost its complete proof.',
        error instanceof PlatformWriteError ? error.code : 'capability_unavailable',
      );
    throw error;
  } finally {
    closed = true;
    page.off('request', onRequest);
    page.off('response', onResponse);
    requests.clear();
  }
}
