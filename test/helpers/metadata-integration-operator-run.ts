interface Ports {
  runId: `${string}-${string}-${string}-${string}-${string}`;
  originalId: string;
  basis: 'operator-title-restore-three-paths/v1';
  event: (phase: string, values?: any) => any;
  tick: () => Promise<string>;
  held: (
    snap: any,
    request: any,
  ) => {
    schema: 'native-short-metadata-held-before/v1';
    phase: 'held-for-write';
    snapshot: any;
    businessRequest: any;
    expectation: any;
    desiredContentHash: string;
    read: {
      proof: {
        platformStarted: boolean;
        ownerBefore: boolean;
        ownerAfter: boolean;
        fixedSourceVerified: boolean;
        targetUnique: boolean;
        paginationComplete: boolean;
        atomicRevision: false;
        readStartedAt: string | null;
        readFinishedAt: string | null;
        proofCapturedAt: string | null;
      };
      requests: Record<
        import('../../src/platform/short-native-metadata-api.js').NativeShortFixedReadKind,
        { attempts: number; disposed: number }
      >;
      list: { pagesRead: number; rowsRead: number; totalCount: number | null };
    };
    cleanup: {
      sessionCreated: boolean;
      sessionDisposed: boolean;
      pendingAtEnd: number;
      disposalFailures: number;
      quarantined: boolean;
      checkedAt: string;
    };
  };
  temporary: any;
  request: {
    expectedSnapshotVersionHash: any;
    hashBasis: 'full-edit-catalog-and-typed-binding/v1';
    expectedState: 'draft';
    title: any;
  };
  originalRef: import('../../src/runtime/store.js').EvidenceRef;
  named: (ref: any) => { id: any; sha256: any; capturedAt: any };
  beforeRef: import('../../src/runtime/store.js').EvidenceRef;
  operatorInputHash: string;
  target: { kind: 'short-story'; id: string };
  phase: () => {
    proof: {
      platformStarted: boolean;
      ownerBefore: boolean;
      ownerAfter: boolean;
      fixedSourceVerified: boolean;
      targetUnique: boolean;
      paginationComplete: boolean;
      atomicRevision: false;
      readStartedAt: string | null;
      readFinishedAt: string | null;
      proofCapturedAt: string | null;
    };
    requests: Record<
      import('../../src/platform/short-native-metadata-api.js').NativeShortFixedReadKind,
      { attempts: number; disposed: number }
    >;
    list: { pagesRead: number; rowsRead: number; totalCount: number | null };
  };
  readResult: (snap: any) => {
    snapshot: any;
    schema: 'native-short-metadata-api-read/v1';
    status: 'success' | 'capability_unavailable';
    reason: import('../../src/platform/short-native-metadata-api.js').NativeShortApiReason | null;
    proof: {
      platformStarted: boolean;
      ownerBefore: boolean;
      ownerAfter: boolean;
      ownerCallback: boolean;
      fixedSourceVerified: boolean;
      targetUnique: boolean;
      paginationComplete: boolean;
      atomicRevision: false;
      readStartedAt: string | null;
      readFinishedAt: string | null;
      proofCapturedAt: string | null;
    };
    requests: Record<
      import('../../src/platform/short-native-metadata-api/native-short-metadata-fixed-read-url.js').RequestKind,
      { attempts: number; disposed: number }
    >;
    list: { pagesRead: number; rowsRead: number; totalCount: number | null };
    cleanup: {
      sessionCreated: boolean;
      sessionDisposed: boolean;
      pendingAtEnd: number;
      disposalFailures: number;
      quarantined: boolean;
      checkedAt: string;
    };
  };
  restored: any;
}
export function createMetadataOperatorRun(ports: Ports) {
  return async (ctx: import('../../src/runtime/jobs.js').JobContext) => {
    ctx.addMetadata({
      schema: 'native-short-metadata-operator-job/v1',
      runId: ports.runId,
      originalUncertainJobId: ports.originalId,
      verificationBasis: ports.basis,
      nativeV1VerificationPassed: false,
    });
    ports.event('restore-job-start', { jobId: ctx.jobId });
    ctx.beforePlatformRead();
    await ports.tick();
    const before = ports.held(ports.temporary, ports.request);
    const baseline = ctx.saveEvidence('operator_title_restore_baseline', {
      schema: 'native-short-metadata-operator-held/v1',
      basis: ports.basis,
      executor: 'operator-owned-browser/v1',
      mode: 'live',
      originalUncertainJobId: ports.originalId,
      originalBaseline: { id: ports.originalRef.id, sha256: ports.originalRef.sha256 },
      freshBefore: ports.named(ports.beforeRef),
      held: before,
    });
    const intent = ctx.saveEvidence('write-intent', {
      schema: 'native-short-metadata-operator-intent/v1',
      basis: ports.basis,
      originalUncertainJobId: ports.originalId,
      originalBaseline: { id: ports.originalRef.id, sha256: ports.originalRef.sha256 },
      baselineEvidence: ports.named(baseline),
      freshBefore: ports.named(ports.beforeRef),
      expectedSnapshotVersionHash: ports.request.expectedSnapshotVersionHash,
      desiredContentHash: before.desiredContentHash,
      operatorInputHash: ports.operatorInputHash,
      target: ports.target,
      expectedStates: ['original_title_restored'],
      maximumPostAttempts: 1,
    });
    ctx.recordTarget(ports.target);
    ports.event('durable-before-mark', {
      jobId: ctx.jobId,
      baseline: ports.named(baseline),
      intent: ports.named(intent),
    });
    const markedAt = ctx.beforePlatformWrite();
    ports.event('restore-marked', { jobId: ctx.jobId, markedAt });
    const afterPhase = ports.phase(),
      checkedAt = new Date().toISOString();
    const native = ctx.saveEvidence('operator_title_restore_native', {
      schema: 'native-short-metadata-operator-v1-outcome/v1',
      basis: ports.basis,
      result: {
        schema: 'native-short-metadata-api-write/v1',
        status: 'capability_unavailable',
        reason: 'readback_mismatch',
        held: null,
        receipt: null,
        snapshot: null,
        comparison: null,
        desiredContentHash: null,
        observedContentHash: null,
        phases: { before: before.read, after: afterPhase },
        post: {
          attempts: 1,
          disposed: 1,
          markedAt,
          startedAt: markedAt,
          acknowledgedAt: markedAt,
          acknowledged: true,
        },
        proof: {
          platformStarted: true,
          writeMarked: true,
          ownerCallback: false,
          atomicRevision: false,
          proofCapturedAt: null,
        },
        cleanup: {
          sessionCreated: true,
          sessionDisposed: true,
          pendingAtEnd: 0,
          disposalFailures: 0,
          quarantined: false,
          checkedAt,
        },
      },
      nativeV1VerificationPassed: false,
    });
    ports.event('native-v1-mismatch-clean', { jobId: ctx.jobId, ref: ports.named(native) });
    await ports.tick();
    const after = ctx.saveEvidence('operator_title_restore_after', {
      schema: 'native-short-metadata-operator-after/v1',
      basis: ports.basis,
      executor: 'operator-owned-browser/v1',
      mode: 'live',
      result: ports.readResult(ports.restored),
      originalBaseline: { id: ports.originalRef.id, sha256: ports.originalRef.sha256 },
      heldBaseline: ports.named(baseline),
      nativeOutcome: ports.named(native),
      originalTitleRestored: true,
      nonServerRawPreserved: true,
      revisionDeltaExactlyOne: true,
      opaqueServerTokenNondecreasing: true,
      nativeV1VerificationPassed: false,
    });
    ports.event('operator-restoration-observed', {
      jobId: ctx.jobId,
      afterEvidence: ports.named(after),
    });
    return {
      schema: 'native-short-metadata-operator-title-restore-result/v1',
      basis: ports.basis,
      runId: ports.runId,
      originalUncertainJobId: ports.originalId,
      originalTitleRestored: true,
      nonServerRawPreserved: true,
      revisionDeltaExactlyOne: true,
      opaqueServerTokenNondecreasing: true,
      nativeV1VerificationPassed: false,
      postAttempts: 1,
      acknowledged: true,
      markedAt,
      baselineEvidence: ports.named(baseline),
      intentEvidence: ports.named(intent),
      nativeOutcomeEvidence: ports.named(native),
      afterEvidence: ports.named(after),
    };
  };
}
