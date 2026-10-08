import {
  Store,
  RuntimeError,
  GENERIC_SHORT_STATUS_PROTOCOL,
  type GenericShortTrustedContext,
} from '../runtime/store.js';
import { type JobContext } from '../runtime/jobs.js';
import * as writes from '../platform/writes.js';
import { hash, record } from './shared.js';
import {
  type GenericCanonicalResultOperation,
  type GenericCaptureOperation,
} from './contracts/generic-write.js';

interface Dependencies {
  genericShortContexts: Map<
    string,
    {
      context: GenericShortTrustedContext;
      witness: Record<string, unknown>;
      sticky: 'capture_failed' | 'persist_failed' | null;
    }
  >;
  genericCapture: GenericCaptureOperation;
  store: Store;
}

export function createGenericCanonicalResult(deps: Dependencies): GenericCanonicalResultOperation {
  function genericCanonicalResult(ctx: JobContext, input: writes.WriteResult): writes.WriteResult {
    const active = deps.genericShortContexts.get(ctx.jobId);
    if (!active) return input;
    if (
      !input ||
      typeof input !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
      Object.getOwnPropertySymbols(input).length
    )
      throw new RuntimeError('capability_unavailable', 'The generic short result is invalid.');
    const descriptors = Object.getOwnPropertyDescriptors(input);
    for (const d of Object.values(descriptors))
      if (!d.enumerable || !Object.hasOwn(d, 'value'))
        throw new RuntimeError('capability_unavailable', 'The generic short result is invalid.');
    const status = descriptors.status?.value,
      required =
        status === 'succeeded'
          ? [
              'status',
              'capability',
              'target',
              'contentHash',
              'platformState',
              'verifiedAt',
              'sourceUrl',
            ]
          : ['status', 'capability', 'reason', 'code'],
      allowed = [
        ...required,
        'statusProtocol',
        'shortObservation',
        ...(status === 'uncertain' ? ['target'] : []),
      ];
    if (
      (status !== 'succeeded' && status !== 'uncertain') ||
      required.some((key) => !Object.hasOwn(descriptors, key)) ||
      Object.keys(descriptors).some((key) => !allowed.includes(key)) ||
      !Object.hasOwn(descriptors, 'statusProtocol') ||
      !Object.hasOwn(descriptors, 'shortObservation')
    )
      throw new RuntimeError(
        'capability_unavailable',
        'The complete generic short result is invalid.',
      );
    const wire = Object.fromEntries(
      Object.entries(descriptors)
        .filter(
          ([key, d]) => !(status === 'uncertain' && key === 'target' && d.value === undefined),
        )
        .map(([key, d]) => [key, d.value]),
    );
    const result = deps.genericCapture(wire);
    if (result.statusProtocol !== GENERIC_SHORT_STATUS_PROTOCOL || active.sticky)
      throw new RuntimeError('capability_unavailable', 'The generic short attempt is incomplete.');
    const refs = deps.store.listEvidence(ctx.jobId),
      last = refs.filter((ref) => ref.dataset === 'editable_snapshot').at(-1);
    if (result.shortObservation === null) {
      if (last || active.witness.stage !== 'source_unavailable')
        throw new RuntimeError(
          'capability_unavailable',
          'A null observation cannot replace captured status.',
        );
    } else {
      const observation = deps.genericCapture(result.shortObservation) as Record<string, unknown>;
      if (
        Object.keys(observation).length !== 3 ||
        observation.schema !== 'fanqie-generic-short-editor-observation/v1' ||
        !['baseline', 'after'].includes(String(observation.phase)) ||
        !last
      )
        throw new RuntimeError('capability_unavailable', 'The writer observation is invalid.');
      const saved = record(deps.store.readEvidence(last).payload);
      if (
        hash(observation) !==
        hash({ schema: saved.schema, phase: saved.phase, snapshot: saved.snapshot })
      )
        throw new RuntimeError(
          'capability_unavailable',
          'The writer result does not match the actual last observation.',
        );
      writes.validateGenericShortSnapshot(observation.snapshot);
      if (status === 'succeeded' && observation.phase !== 'after')
        throw new RuntimeError(
          'capability_unavailable',
          'A confirmed save requires its actual after observation.',
        );
    }
    return Object.fromEntries(
      Object.entries(result).filter(
        ([key]) => !['statusProtocol', 'shortObservation'].includes(key),
      ),
    ) as unknown as writes.WriteResult;
  }
  return genericCanonicalResult;
}
