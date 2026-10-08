import { createDirectoryRead } from './read-directory-json.js';
import { createFreshOwn } from './fresh-own.js';

import { PlatformReadError, verifyCurrentChapterBook } from '../../reads.js';

import { CANONICAL_OWN_USER_URL } from '../contracts.js';
import { inspectEncodedChapterRoute } from '../chapter-routes.js';

import { type ChapterReadState } from './chapterReadScope.js';

export async function executeDraftRead(chapterReadScope: ChapterReadState): Promise<void> {
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
    return;
  }
  // The confirmed canonical schema proves an account ID, never an author ID.
  if (binding?.kind !== 'account') {
    chapterReadScope.diagnostic.reason = 'identity_unverified';
    return;
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
    return;
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
      return;
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
      return;
    }
    chapterReadScope.cdpSource.initialized = true;
  } catch {
    chapterReadScope.cdpFault('initialization_failed', {
      site: 'initialization_callback',
      predicate: 'callback_exception',
    });
    chapterReadScope.diagnostic.reason = 'context_unavailable';
    return;
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
    return;
  }
  chapterReadScope.bootstrapSubphase = 'writer_ready';
  if (
    !(await chapterReadScope.deps.waitForWriterReady(
      chapterReadScope.page,
      chapterReadScope.timeout,
    ))
  ) {
    chapterReadScope.diagnostic.reason = 'shell_unready';
    return;
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
    return;
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
    return;
  }
  chapterReadScope.diagnostic.checks.sameOwnerBefore =
    current.kind === binding.kind && current.id === binding.id;
  if (!chapterReadScope.diagnostic.checks.sameOwnerBefore) {
    chapterReadScope.diagnostic.reason = 'owner_changed';
    return;
  }
  chapterReadScope.collectionStage = 'directory_read';
  await chapterReadScope.acquireCollectionSources();
  chapterReadScope.assertStable();
  if (!chapterReadScope.sealedCollectionSources) {
    chapterReadScope.diagnostic.reason = chapterReadScope.sourceFamiliesAmbiguous()
      ? 'template_ambiguous'
      : 'template_missing';
    return;
  }
  const { draft: draftSource, book: bookSource } = chapterReadScope.sealedCollectionSources;
  const readDirectoryJson = createDirectoryRead({ chapterReadScope, ownedRequest });
  try {
    const routeIdentity = inspectEncodedChapterRoute(chapterReadScope.target.pathname);
    if (
      routeIdentity.status !== 'decoded' ||
      routeIdentity.workId !== chapterReadScope.workId ||
      routeIdentity.title === null
    )
      throw new PlatformReadError(
        'chapter_book_parent_mismatch',
        'The verified draft route does not match its book',
      );
    verifyCurrentChapterBook(
      await readDirectoryJson(bookSource),
      chapterReadScope.workId,
      routeIdentity.title,
    );
    await chapterReadScope.collectDraftPages(draftSource, readDirectoryJson);
    verifyCurrentChapterBook(
      await readDirectoryJson(bookSource),
      chapterReadScope.workId,
      routeIdentity.title,
    );
  } catch (error) {
    if (error instanceof PlatformReadError) chapterReadScope.collectionFailure = error.code;
    throw error;
  }
  chapterReadScope.collectionStage = 'fresh_own_after';
  const after = await freshOwnContext('after');
  chapterReadScope.assertStable();
  if (chapterReadScope.collection)
    chapterReadScope.collection.failureMetadata.identityTypes.afterAccepted = after !== null;
  if (!after) {
    chapterReadScope.diagnostic.reason = 'identity_unverified';
    return;
  }
  chapterReadScope.diagnostic.checks.sameOwnerAfter =
    after.kind === binding.kind && after.id === binding.id;
  if (!chapterReadScope.diagnostic.checks.sameOwnerAfter) {
    chapterReadScope.diagnostic.reason = 'owner_changed';
    return;
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
  chapterReadScope.diagnostic.status = 'success';
  chapterReadScope.diagnostic.reason = null;
}
