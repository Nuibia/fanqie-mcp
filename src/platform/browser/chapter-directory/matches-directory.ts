import { type Dependencies } from '../operations/enter-current-chapter-directory.js';
import { validateDiagnosticSource, chapterDirectoryWorkId } from '../chapter-routes.js';

interface Ports {
  bootstrapDestination: URL | null;
  deps: Dependencies;
  workId: string;
}
export function createDirectoryMatcher(ports: Ports) {
  return (raw: string): boolean => {
    try {
      if (!ports.bootstrapDestination) return false;
      const current = validateDiagnosticSource(raw, ports.deps.discoveredStableTargets);
      if (
        current.pathname !== ports.bootstrapDestination.pathname ||
        chapterDirectoryWorkId(raw) !== ports.workId
      )
        return false;
      // The canonical path includes the previously verified ID and encoded title.
      // An initialization query transition is allowed only for the same path and
      // unique numeric read keys, with every explicit parent still this work.
      return ['book_id', 'bookId', 'work_id', 'workId'].every(
        (key) => !current.searchParams.has(key) || current.searchParams.get(key) === ports.workId,
      );
    } catch {
      return false;
    }
  };
}
