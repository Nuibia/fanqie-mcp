import { type ReadPageDiagnostic } from '../chapter-diagnostics.js';
import { createBodyRead } from './read-body.js';
import { createQualifyManagement } from './qualify-management.js';
import { createFreshOwn } from './fresh-own.js';
import { createDirectoryRead } from './read-directory-json.js';

import { type LoginState } from '../own-identity.js';
import {
  projectReadResponseFields,
  PlatformReadError,
  verifyCurrentChapterBook,
  parseCurrentChapterVolumes,
  parseChapterPage,
} from '../../reads.js';

import { CANONICAL_OWN_USER_URL } from '../contracts.js';
import { inspectEncodedChapterRoute } from '../chapter-routes.js';

import { type ChapterReadState } from './chapterReadScope.js';

export async function executeChapterRead(
  chapterReadScope: ChapterReadState,
): Promise<ReadPageDiagnostic | void> {
  await chapterReadScope.page.route('**/*', chapterReadScope.readOnlyRoute);
  chapterReadScope.guarded = true;
  // The collection path is selected before any identity read in this bracket.
  // Its registered entry owner is only a typed constraint: actual identity
  // is read by the frozen canonical own-before/after GETs below.
  let binding:
    | {
        kind: 'account' | 'author';
        id: string;
      }
    | undefined;
  if (chapterReadScope.collection) {
    chapterReadScope.collectionStage = 'target_owner_binding';
    binding = chapterReadScope.deps.chapterTargetOwners.get(chapterReadScope.targetRef);
    chapterReadScope.collection.failureMetadata.identityTypes.bindingAccountKind =
      binding?.kind === 'account';
    chapterReadScope.collection.failureMetadata.identityTypes.bindingAuthorKind =
      binding?.kind === 'author';
    if (
      !binding ||
      chapterReadScope.collection.options.expectedOwner.kind !== binding.kind ||
      chapterReadScope.collection.options.expectedOwner.id !== binding.id
    ) {
      chapterReadScope.diagnostic.reason = 'target_owner_mismatch';
      return chapterReadScope.result;
    }
    // No page verify was performed here; initial metadata remains null.
  } else {
    const before = await chapterReadScope.deps.verifyCurrentAccount(chapterReadScope.page);
    chapterReadScope.result.identityObserved = {
      accountId: Boolean(before.identity?.accountId),
      authorId: Boolean(before.identity?.authorId),
      displayName: Boolean(before.identity?.displayName),
    };
    binding = chapterReadScope.deps.chapterTargetOwners.get(chapterReadScope.targetRef);
    if (
      before.status !== 'authenticated' ||
      (!before.identity?.accountId && !before.identity?.authorId)
    ) {
      chapterReadScope.diagnostic.reason = 'identity_unverified';
      chapterReadScope.diagnostic.status =
        before.status === 'login_required' ? 'login_required' : 'capability_unavailable';
      return chapterReadScope.result;
    }
    chapterReadScope.collectionStage = 'target_owner_binding';
    const sameOwner = (value: LoginState) =>
      value.status === 'authenticated' &&
      Boolean(
        binding &&
        (binding.kind === 'account' ? value.identity?.accountId : value.identity?.authorId) ===
          binding.id,
      );
    if (!sameOwner(before)) {
      chapterReadScope.diagnostic.reason = 'target_owner_mismatch';
      return chapterReadScope.result;
    }
  }
  // The confirmed canonical schema proves an account ID, never an author ID.
  if (binding?.kind !== 'account') {
    chapterReadScope.diagnostic.reason = 'identity_unverified';
    return chapterReadScope.result;
  }
  chapterReadScope.collectionStage = 'canonical_bootstrap';
  const contextBefore = chapterReadScope.deps.context,
    attachUrl = chapterReadScope.page.url();
  if (
    !contextBefore ||
    chapterReadScope.page.context() !== contextBefore ||
    !contextBefore.request
  ) {
    chapterReadScope.cdpSource.failure = 'unavailable';
    chapterReadScope.diagnostic.reason = 'context_unavailable';
    return chapterReadScope.result;
  }
  chapterReadScope.requestContext = contextBefore;
  const ownedRequest = contextBefore.request;
  const freshOwnContext = createFreshOwn({ chapterReadScope, ownedRequest });
  try {
    chapterReadScope.bootstrapSubphase = 'cdp_attach';
    chapterReadScope.cdp = await contextBefore.newCDPSession(chapterReadScope.page);
    chapterReadScope.cdpSource.connected = true;
    chapterReadScope.cdp.on('Page.frameStartedNavigating', chapterReadScope.cdpStart);
    chapterReadScope.cdp.on('Page.frameNavigated', chapterReadScope.cdpCommitted);
    chapterReadScope.cdp.on('Page.navigatedWithinDocument', chapterReadScope.cdpWithinDocument);
    chapterReadScope.cdp.on('Network.requestWillBeSent', chapterReadScope.cdpRequest);
    chapterReadScope.cdp.on('Page.frameDetached', chapterReadScope.cdpFrameDetached);
    chapterReadScope.cdp.on('close', chapterReadScope.cdpClosed);
    chapterReadScope.bootstrapSubphase = 'page_enable';
    await chapterReadScope.cdp.send('Page.enable');
    chapterReadScope.bootstrapSubphase = 'network_enable';
    await chapterReadScope.cdp.send('Network.enable');
    chapterReadScope.bootstrapSubphase = 'initial_frame_tree';
    const initial = (await chapterReadScope.cdp.send('Page.getFrameTree')).frameTree.frame;
    chapterReadScope.bootstrapSubphase = 'initial_checks';
    if (
      !chapterReadScope.observeBootstrapInitial('active', chapterReadScope.active()) ||
      !chapterReadScope.observeBootstrapInitial(
        'sameContext',
        chapterReadScope.deps.context === contextBefore,
      ) ||
      !chapterReadScope.observeBootstrapInitial(
        'ownedContext',
        chapterReadScope.page.context() === contextBefore,
      ) ||
      !chapterReadScope.observeBootstrapInitial(
        'currentUrlMatchesAttach',
        chapterReadScope.page.url() === attachUrl,
      ) ||
      !chapterReadScope.observeBootstrapInitial('noParent', !initial.parentId) ||
      !chapterReadScope.observeBootstrapInitial(
        'frameIdPresent',
        chapterReadScope.nonempty(initial.id),
      ) ||
      !chapterReadScope.observeBootstrapInitial(
        'loaderIdPresent',
        chapterReadScope.nonempty(initial.loaderId),
      ) ||
      !chapterReadScope.observeBootstrapInitial('noFragment', !initial.urlFragment) ||
      !chapterReadScope.observeBootstrapInitial('frameUrlMatchesAttach', initial.url === attachUrl)
    ) {
      chapterReadScope.cdpFault('initialization_failed', {
        site: 'initial_checks',
        predicate: 'guard_failed',
      });
      chapterReadScope.diagnostic.reason = 'document_changed';
      return chapterReadScope.result;
    }
    chapterReadScope.rootFrame = initial.id;
    chapterReadScope.loader = initial.loaderId;
    chapterReadScope.cdpSource.rootFrameObserved = true;
    chapterReadScope.bootstrapSubphase = 'initial_events';
    for (const event of chapterReadScope.deferredCdp.splice(0)) event();
    if (
      chapterReadScope.violated ||
      chapterReadScope.pendingNavigation ||
      chapterReadScope.pendingSameDocument ||
      !chapterReadScope.cdpSource.connected
    ) {
      chapterReadScope.diagnostic.reason = 'document_changed';
      return chapterReadScope.result;
    }
    chapterReadScope.cdpSource.initialized = true;
  } catch {
    chapterReadScope.cdpFault('initialization_failed', {
      site: 'initialization_callback',
      predicate: 'callback_exception',
    });
    chapterReadScope.diagnostic.reason = 'context_unavailable';
    return chapterReadScope.result;
  }
  chapterReadScope.controlledGoto = true;
  chapterReadScope.bootstrapSubphase = 'controlled_goto';
  await chapterReadScope.page.goto(chapterReadScope.target.toString(), {
    waitUntil: 'domcontentloaded',
  });
  chapterReadScope.bootstrapSubphase = 'network_idle';
  await chapterReadScope.page
    .waitForLoadState('networkidle', { timeout: Math.min(4000, chapterReadScope.timeout) })
    .catch(() => undefined);
  chapterReadScope.bootstrapSubphase = 'abort_drain';
  await chapterReadScope.settleAborts();
  chapterReadScope.bootstrapSubphase = 'bootstrap_gate';
  chapterReadScope.navigationTelemetry.bootstrapGate = chapterReadScope.navigationState();
  if (
    !chapterReadScope.active() ||
    chapterReadScope.violated ||
    !chapterReadScope.committed ||
    !chapterReadScope.permittedRoute(chapterReadScope.page.url())
  ) {
    chapterReadScope.diagnostic.reason = chapterReadScope.fatalBlocked
      ? 'bootstrap_request_blocked'
      : 'document_changed';
    return chapterReadScope.result;
  }
  chapterReadScope.bootstrapSubphase = 'writer_ready';
  if (
    !(await chapterReadScope.deps.waitForWriterReady(
      chapterReadScope.page,
      chapterReadScope.timeout,
    ))
  ) {
    chapterReadScope.diagnostic.reason = 'shell_unready';
    return chapterReadScope.result;
  }
  chapterReadScope.bootstrapSubphase = 'freeze_frame_tree';
  const barrier = (await chapterReadScope.cdp.send('Page.getFrameTree')).frameTree.frame;
  chapterReadScope.bootstrapSubphase = 'freeze_checks';
  if (
    !chapterReadScope.observeBootstrapFreeze(
      'rootMatches',
      barrier.id === chapterReadScope.rootFrame,
    ) ||
    !chapterReadScope.observeBootstrapFreeze('noParent', !barrier.parentId) ||
    !chapterReadScope.observeBootstrapFreeze(
      'loaderMatches',
      barrier.loaderId === chapterReadScope.loader,
    ) ||
    !chapterReadScope.observeBootstrapFreeze(
      'loaderPresent',
      chapterReadScope.nonempty(chapterReadScope.loader),
    ) ||
    !chapterReadScope.observeBootstrapFreeze('noFragment', !barrier.urlFragment) ||
    !chapterReadScope.observeBootstrapFreeze(
      'frameUrlMatchesCurrent',
      barrier.url === chapterReadScope.page.url(),
    ) ||
    !chapterReadScope.observeBootstrapFreeze(
      'permittedRoute',
      chapterReadScope.permittedRoute(barrier.url),
    ) ||
    !chapterReadScope.observeBootstrapFreeze(
      'noPendingNavigation',
      !chapterReadScope.pendingNavigation,
    ) ||
    !chapterReadScope.observeBootstrapFreeze(
      'noPendingSameDocument',
      !chapterReadScope.pendingSameDocument,
    ) ||
    !chapterReadScope.observeBootstrapFreeze('noViolation', !chapterReadScope.violated) ||
    !chapterReadScope.observeBootstrapFreeze('connected', chapterReadScope.cdpSource.connected)
  ) {
    chapterReadScope.cdpFault('source_unverified', {
      site: 'freeze_checks',
      predicate: 'guard_failed',
    });
    chapterReadScope.diagnostic.reason = 'document_changed';
    return chapterReadScope.result;
  }
  chapterReadScope.bootstrapSubphase = 'freeze_commit';
  chapterReadScope.frozen = true;
  chapterReadScope.frozenGeneration = chapterReadScope.generation;
  chapterReadScope.frozenLoader = chapterReadScope.loader;
  chapterReadScope.frozenUrl = chapterReadScope.page.url();
  chapterReadScope.assertStable();
  chapterReadScope.openCollectionSourceWindow();
  chapterReadScope.collectionStage = 'fresh_own_before';
  const current = await freshOwnContext('before');
  chapterReadScope.assertStable();
  if (chapterReadScope.collection)
    chapterReadScope.collection.failureMetadata.identityTypes.beforeAccepted = current !== null;
  if (!current) {
    chapterReadScope.diagnostic.reason = 'identity_unverified';
    return chapterReadScope.result;
  }
  chapterReadScope.diagnostic.checks.sameOwnerBefore =
    current.kind === binding.kind && current.id === binding.id;
  if (!chapterReadScope.diagnostic.checks.sameOwnerBefore) {
    chapterReadScope.diagnostic.reason = 'owner_changed';
    return chapterReadScope.result;
  }
  chapterReadScope.collectionStage = 'volume_get';
  if (chapterReadScope.collection) {
    await chapterReadScope.acquireCollectionSources();
    chapterReadScope.assertStable();
  }
  chapterReadScope.diagnostic.checks.templateObserved = chapterReadScope.templates.size > 0;
  chapterReadScope.diagnostic.checks.templateUnique = chapterReadScope.templates.size === 1;
  if (!chapterReadScope.templates.size) {
    chapterReadScope.diagnostic.reason = 'template_missing';
    return chapterReadScope.result;
  }
  if (chapterReadScope.templates.size !== 1) {
    chapterReadScope.diagnostic.reason = 'template_ambiguous';
    return chapterReadScope.result;
  }
  if (chapterReadScope.collection && !chapterReadScope.sealedCollectionSources) {
    chapterReadScope.collectionFailure = 'chapter_current_sources_unverified';
    chapterReadScope.diagnostic.reason =
      chapterReadScope.bookTemplates.size > 1 || chapterReadScope.chapterTemplates.size > 1
        ? 'template_ambiguous'
        : 'template_missing';
    return chapterReadScope.result;
  }
  chapterReadScope.diagnostic.checks.mainFrameRequest =
    chapterReadScope.diagnostic.checks.currentDocumentRequest =
    chapterReadScope.diagnostic.checks.parentBound =
      true;
  const context = chapterReadScope.deps.context;
  chapterReadScope.diagnostic.checks.sameContext =
    context !== null && chapterReadScope.page.context() === context;
  if (!context || !chapterReadScope.diagnostic.checks.sameContext || !context.request) {
    chapterReadScope.diagnostic.reason = 'context_unavailable';
    return chapterReadScope.result;
  }
  const template = chapterReadScope.collection
    ? chapterReadScope.sealedCollectionSources!.volume
    : [...chapterReadScope.templates][0]!;
  chapterReadScope.assertStable();
  chapterReadScope.diagnostic.attempts = 1;
  // This owned context is launched without httpCredentials. No manual headers,
  // params, credentials export, cache/referer invention, redirects or retries.
  chapterReadScope.response = await ownedRequest.get(template, {
    maxRedirects: 0,
    maxRetries: 0,
    failOnStatusCode: false,
    timeout: chapterReadScope.timeout,
    ...(chapterReadScope.options.signal ? { signal: chapterReadScope.options.signal } : {}),
  });
  chapterReadScope.assertStable();
  chapterReadScope.diagnostic.responseStatus = chapterReadScope.response.status();
  chapterReadScope.diagnostic.checks.exactResponseUrl =
    chapterReadScope.response.url() === template;
  chapterReadScope.diagnostic.checks.httpSuccess =
    chapterReadScope.response.ok() &&
    chapterReadScope.diagnostic.responseStatus >= 200 &&
    chapterReadScope.diagnostic.responseStatus < 300;
  if (!chapterReadScope.diagnostic.checks.exactResponseUrl) {
    chapterReadScope.diagnostic.reason = 'response_url_changed';
    return chapterReadScope.result;
  }
  if (!chapterReadScope.diagnostic.checks.httpSuccess) {
    chapterReadScope.diagnostic.reason = 'http_failed';
    return chapterReadScope.result;
  }
  let json: unknown;
  try {
    json = await chapterReadScope.response.json();
  } catch {
    chapterReadScope.diagnostic.reason = 'json_unavailable';
    return chapterReadScope.result;
  }
  chapterReadScope.assertStable();
  chapterReadScope.diagnostic.checks.codeZero =
    json !== null &&
    typeof json === 'object' &&
    !Array.isArray(json) &&
    (
      json as {
        code?: unknown;
      }
    ).code === 0;
  if (!chapterReadScope.diagnostic.checks.codeZero) {
    chapterReadScope.diagnostic.reason = 'code_not_zero';
    return chapterReadScope.result;
  }
  if (chapterReadScope.collection) {
    chapterReadScope.collectionStage = 'directory_read';
    const readDirectoryJson = createDirectoryRead({ chapterReadScope, ownedRequest });
    try {
      if (chapterReadScope.bookTemplates.size !== 1 || chapterReadScope.chapterTemplates.size !== 1)
        throw new PlatformReadError(
          'chapter_current_sources_unverified',
          'Current book and chapter sources must each be unique',
        );
      const bookTemplate = chapterReadScope.sealedCollectionSources!.book,
        chapterTemplate = chapterReadScope.sealedCollectionSources!.chapter;
      const routeIdentity = inspectEncodedChapterRoute(chapterReadScope.target.pathname);
      if (
        routeIdentity.status !== 'decoded' ||
        routeIdentity.workId !== chapterReadScope.workId ||
        routeIdentity.title === null
      )
        throw new PlatformReadError(
          'chapter_book_parent_mismatch',
          'The verified book route does not match its parent',
        );
      const volumes = parseCurrentChapterVolumes(json, chapterReadScope.workId);
      const chapterUrl = new URL(chapterTemplate),
        volumeIds = chapterUrl.searchParams.getAll('volume_id');
      if (volumeIds.length !== 1 || !volumes.some((volume) => volume.volumeId === volumeIds[0]))
        throw new PlatformReadError(
          'chapter_current_volume_unverified',
          'The current chapter GET must bind exactly one observed volume',
        );
      verifyCurrentChapterBook(
        await readDirectoryJson(bookTemplate),
        chapterReadScope.workId,
        routeIdentity.title,
      );
      chapterReadScope.managementDeadline =
        performance.now() +
        Math.min(60000, Math.max(1, chapterReadScope.options.timeoutMs ?? 60000));
      const qualifyInitialManagement = createQualifyManagement({
        chapterReadScope,
        volumes,
        volumeIds,
      });
      chapterReadScope.initialManagementQualified = await qualifyInitialManagement();
      chapterReadScope.collected = parseChapterPage(
        await readDirectoryJson(chapterTemplate),
        chapterReadScope.workId,
        volumeIds[0]!,
      );
      chapterReadScope.initialManagementQualified =
        chapterReadScope.initialManagementQualified && (await qualifyInitialManagement());
      chapterReadScope.chapterPagesFetched = 1;
      chapterReadScope.managementCoverage = {
        scope: 'management_all_statuses',
        status: 'unverified',
        draftsCovered: false,
        inventoryVolumes: volumes.length,
        matchedVolumes: 0,
        completedVolumes: 0,
        pagesFetched: 1,
        recordsFetched: chapterReadScope.collected.records.length,
        allStatusObserved: false,
        inventoryReconciled: false,
        reasons: [],
      };
      await chapterReadScope.collectManagementViews(
        volumes,
        volumeIds[0]!,
        chapterTemplate,
        readDirectoryJson,
      );
      if (chapterReadScope.collection.bodyRead) {
        const readBody = createBodyRead({ chapterReadScope, volumes, ownedRequest });
        await readBody();
      }
      const lastVolumes = parseCurrentChapterVolumes(
        await readDirectoryJson(template),
        chapterReadScope.workId,
      );
      if (JSON.stringify(volumes) !== JSON.stringify(lastVolumes))
        throw new PlatformReadError(
          'chapter_inventory_changed',
          'The current volume inventory changed during the directory read',
        );
      verifyCurrentChapterBook(
        await readDirectoryJson(bookTemplate),
        chapterReadScope.workId,
        routeIdentity.title,
      );
    } catch (error) {
      if (error instanceof PlatformReadError) chapterReadScope.collectionFailure = error.code;
      throw error;
    }
  }
  chapterReadScope.collectionStage = 'fresh_own_after';
  const after = await freshOwnContext('after');
  chapterReadScope.assertStable();
  if (chapterReadScope.collection)
    chapterReadScope.collection.failureMetadata.identityTypes.afterAccepted = after !== null;
  if (!after) {
    chapterReadScope.diagnostic.reason = 'identity_unverified';
    return chapterReadScope.result;
  }
  chapterReadScope.diagnostic.checks.sameOwnerAfter =
    after.kind === binding.kind && after.id === binding.id;
  if (!chapterReadScope.diagnostic.checks.sameOwnerAfter) {
    chapterReadScope.diagnostic.reason = 'owner_changed';
    return chapterReadScope.result;
  }
  if (chapterReadScope.collection)
    chapterReadScope.verifiedOwner = {
      status: 'authenticated',
      identity: {
        accountId: after.id,
        authorId: null,
        displayName: null,
        evidenceSource: CANONICAL_OWN_USER_URL,
      },
      sourceUrl: CANONICAL_OWN_USER_URL,
      checkedAt: new Date().toISOString(),
    };
  chapterReadScope.schema = {
    pathTemplate: chapterReadScope.diagnostic.pathTemplate,
    status: chapterReadScope.diagnostic.responseStatus,
    ...projectReadResponseFields(json),
  };
  chapterReadScope.diagnostic.status = 'success';
  chapterReadScope.diagnostic.reason = null;
}
