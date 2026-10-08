import * as writes from '../platform/writes.js';
import { type RuntimeTargetOperation } from './contracts/maintenance.js';

interface Dependencies {}

export function createRuntimeTarget(deps: Dependencies): RuntimeTargetOperation {
  function runtimeTarget(target: writes.WriteTarget | writes.LongBookMetadataTarget) {
    if (target.kind === 'long-book') return { kind: 'long-book' as const, id: target.workId };
    return target.kind === 'short'
      ? { kind: 'short-story' as const, id: target.workId }
      : { kind: 'chapter' as const, id: target.chapterId!, parentId: target.workId };
  }
  return runtimeTarget;
}
