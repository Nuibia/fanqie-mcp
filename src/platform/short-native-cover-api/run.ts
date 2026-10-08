import {
  type NativeShortCoverApiResult,
  type OwnedNativeShortCoverRunOwner,
  type OwnedNativeShortCoverRunGlobals,
} from '../short-native-cover-api.js';

import {
  NativeShortCoverError,
  createNativeShortCoverUploadIntent,
  assertNativeShortCoverPreSave,
  planNativeShortCoverSave,
  compareNativeShortCoverReadback,
  nativeShortCoverDesiredContentHash,
  validateNativeShortCoverAsset,
  type NativeShortCoverPreparedAsset,
  type NativeShortCoverPlan,
} from '../short-native-cover.js';
import { prepareNativeShortCoverImage } from '../short-native-cover-image.js';

export function createOwnedNativeShortCoverRunRun(
  deps: Pick<
    OwnedNativeShortCoverRunOwner,
    | 'started'
    | 'stop'
    | 'options'
    | 'timer'
    | 'optionsValid'
    | 'workId'
    | 'fail'
    | 'businessRequest'
    | 'check'
    | 'borrowed'
    | 'track'
    | 'preparer'
    | 'imageAbortController'
    | 'disposalFailed'
    | 'reason'
    | 'copiedBytes'
    | 'result'
    | 'api'
    | 'factory'
    | 'startDispose'
    | 'read'
    | 'held'
    | 'callback'
    | 'post'
    | 'pending'
  >,
  globals: Pick<
    OwnedNativeShortCoverRunGlobals,
    'OWNER' | 'WORK' | 'fields' | 'hashBytes' | 'copyCookies' | 'ORIGIN' | 'freeze'
  >,
) {
  async function run(): Promise<NativeShortCoverApiResult> {
    if (deps.started) throw Error('Owned cover run is single-use');
    deps.started = true;
    const abort = () => deps.stop('cancelled');
    if (deps.options.signal)
      EventTarget.prototype.addEventListener.call(deps.options.signal, 'abort', abort, {
        once: true,
      });
    deps.timer = setTimeout(
      () => deps.stop('timeout'),
      Math.max(1, deps.options.deadline - performance.now()),
    );
    try {
      if (
        !deps.optionsValid ||
        deps.options.mode !== 'write' ||
        deps.options.expectedOwner.kind !== 'account' ||
        typeof deps.options.expectedOwner.id !== 'string' ||
        !globals.OWNER.test(deps.options.expectedOwner.id) ||
        typeof deps.workId !== 'string' ||
        !globals.WORK.test(deps.workId) ||
        !Number.isFinite(deps.options.deadline) ||
        typeof deps.options.uploadDir !== 'string' ||
        !deps.options.uploadDir
      )
        deps.fail('identity_unverified');
      if (!deps.businessRequest) deps.fail('unsupported_schema');
      deps.check();
      const browser = deps.borrowed.browser();
      if (!browser) deps.fail('context_unavailable');
      let prepared: Awaited<ReturnType<typeof prepareNativeShortCoverImage>>;
      try {
        prepared = await deps.track(
          deps.preparer(browser, deps.options.uploadDir, deps.businessRequest.cover, {
            signal: deps.imageAbortController.signal,
            timeoutMs: Math.min(
              60_000,
              Math.max(1, Math.ceil(deps.options.deadline - performance.now())),
            ),
          }),
        );
      } catch (error) {
        if (
          error instanceof NativeShortCoverError &&
          error.code === 'native_short_cover_image_cleanup_failed'
        ) {
          deps.disposalFailed();
          deps.fail('cleanup_failed');
        }
        if (!deps.reason) deps.stop('image_unavailable');
        throw Error('Cover preparation unavailable');
      }
      deps.check();
      const values = globals.fields(prepared, ['asset', 'bytes']);
      let asset: NativeShortCoverPreparedAsset;
      try {
        asset = validateNativeShortCoverAsset(values.asset);
      } catch {
        deps.fail('image_unavailable');
      }
      if (
        !Buffer.isBuffer(values.bytes) ||
        values.bytes.length !== asset.preparedSize ||
        asset.sourceSha256 !== deps.businessRequest.cover.sha256 ||
        asset.policy.fit !== (deps.businessRequest.cover.fit ?? 'cover')
      )
        deps.fail('image_unavailable');
      deps.copiedBytes = Buffer.from(values.bytes);
      if (globals.hashBytes(deps.copiedBytes) !== asset.preparedSha256)
        deps.fail('image_unavailable');
      deps.result.asset = asset;
      const cookies = globals.copyCookies(await deps.track(deps.borrowed.cookies(globals.ORIGIN)));
      deps.check();
      deps.api = await deps.track(
        deps.factory.newContext({ storageState: { cookies, origins: [] } }),
      );
      deps.result.cleanup.sessionCreated = true;
      if (deps.reason) deps.startDispose();
      deps.check();
      const before = await deps.read(deps.result.phases.before);
      deps.result.snapshots.before = before;
      deps.check();
      try {
        deps.result.uploadIntent = createNativeShortCoverUploadIntent(before, {
          expectedSnapshotVersionHash: deps.businessRequest.expectedSnapshotVersionHash,
          hashBasis: deps.businessRequest.hashBasis,
          expectedState: 'draft',
          asset,
        });
        assertNativeShortCoverPreSave(before, deps.result.uploadIntent);
      } catch (error) {
        deps.fail(
          error instanceof NativeShortCoverError && error.code === 'source_version_mismatch'
            ? 'version_conflict'
            : 'unsupported_schema',
        );
      }
      deps.result.upload.held = deps.held('upload', before);
      deps.result.upload.intentReceipt = await deps.callback(
        'upload',
        'intent',
        deps.result.upload.held,
      );
      deps.check();
      deps.result.upload.attemptReceipt = await deps.callback(
        'upload',
        'attempt',
        deps.result.upload.held,
      );
      deps.check();
      deps.result.upload.post.markedAt = deps.result.upload.attemptReceipt.eventAt;
      const upload = await deps.post('upload');
      deps.check();
      let provisional: NativeShortCoverPlan;
      try {
        const ack = globals.fields(upload, Object.keys(upload), ['pic_uri', 'pic_url']);
        provisional = planNativeShortCoverSave(before, deps.result.uploadIntent, {
          picUri: ack.pic_uri as string,
          picUrl: ack.pic_url as string,
        });
      } catch {
        deps.fail('response_unverified');
      }
      deps.result.upload.acknowledgementReceipt = await deps.callback(
        'upload',
        'acknowledgement',
        deps.result.upload.held,
        deps.result.upload.observation!,
      );
      deps.check();
      const preSave = await deps.read(deps.result.phases.preSave);
      deps.result.snapshots.preSave = preSave;
      deps.check();
      let plan: NativeShortCoverPlan;
      try {
        assertNativeShortCoverPreSave(preSave, deps.result.uploadIntent);
        plan = planNativeShortCoverSave(preSave, deps.result.uploadIntent, {
          picUri: deps.result.upload.observation!.picUri!,
          picUrl: deps.result.upload.observation!.picUrl!,
        });
        if (
          plan.desiredContentHash !== provisional.desiredContentHash ||
          plan.uploadAckHash !== provisional.uploadAckHash
        )
          deps.fail('version_conflict');
      } catch {
        deps.fail('version_conflict');
      }
      deps.result.expectation = plan.expectation;
      deps.result.desiredContentHash = plan.desiredContentHash;
      deps.result.save.held = deps.held('save', preSave, plan);
      deps.result.save.intentReceipt = await deps.callback('save', 'intent', deps.result.save.held);
      deps.check();
      deps.result.save.attemptReceipt = await deps.callback(
        'save',
        'attempt',
        deps.result.save.held,
      );
      deps.check();
      deps.result.save.post.markedAt = deps.result.save.attemptReceipt.eventAt;
      await deps.post('save', plan);
      deps.check();
      deps.result.save.acknowledgementReceipt = await deps.callback(
        'save',
        'acknowledgement',
        deps.result.save.held,
        deps.result.save.observation!,
      );
      deps.check();
      deps.result.snapshot = await deps.read(deps.result.phases.after);
      deps.result.snapshots.after = deps.result.snapshot;
      deps.check();
      deps.result.comparison = compareNativeShortCoverReadback(
        plan.expectation,
        deps.result.snapshot,
      );
      if (!deps.result.comparison.matches) deps.fail('readback_mismatch');
      const actual = deps.result.comparison.actual;
      deps.result.observedContentHash = nativeShortCoverDesiredContentHash({
        ...plan.expectation,
        binding: deps.result.snapshot.binding,
        catalogHash: actual.catalogHash,
        documentHash: actual.documentHash,
        savedFieldsHash: actual.savedFieldsHash,
        categorySelectionHash: actual.categorySelectionHash,
        preservationHash: actual.preservationHash,
        coverUriHash: actual.coverUriHash,
      });
      if (deps.result.observedContentHash !== plan.desiredContentHash)
        deps.fail('readback_mismatch');
    } catch {
      if (!deps.reason) deps.stop('response_unavailable');
    } finally {
      deps.startDispose();
      while (deps.pending.size) await Promise.allSettled([...deps.pending]);
      deps.copiedBytes = null;
      deps.result.cleanup.pendingAtEnd = deps.pending.size;
      deps.result.cleanup.checkedAt = new Date().toISOString();
    }
    try {
      deps.check();
      if (
        !deps.result.comparison?.matches ||
        !deps.result.save.acknowledgementReceipt ||
        !deps.result.cleanup.sessionDisposed ||
        deps.result.cleanup.quarantined
      )
        deps.fail('cleanup_failed');
      const checkedAt = new Date().toISOString();
      try {
        await deps.track(
          Promise.resolve().then(() => {
            deps.check();
            return deps.options.onVerifiedAccount(deps.options.expectedOwner.id, checkedAt);
          }),
        );
      } catch {
        deps.fail('callback_failed');
      }
      deps.check();
      deps.result.proof.ownerCallback = true;
      deps.result.proof.proofCapturedAt = checkedAt;
      deps.result.save.outcome = 'verified';
      deps.result.status = 'success';
      deps.result.reason = null;
    } catch {
      deps.result.reason = deps.reason ?? 'response_unavailable';
    } finally {
      if (deps.timer) clearTimeout(deps.timer);
      if (deps.options.signal)
        EventTarget.prototype.removeEventListener.call(deps.options.signal, 'abort', abort);
    }
    return globals.freeze(deps.result);
  }
  return { run };
}
