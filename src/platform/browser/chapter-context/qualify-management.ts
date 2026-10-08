import { currentManagementDom } from '../chapter-dom.js';
import { type ChapterReadState } from './chapterReadScope.js';

interface Ports {
  chapterReadScope: ChapterReadState;
  volumes: (import('../../reads.js').ChapterVolume & { index: number; name: string })[];
  volumeIds: string[];
}
export function createQualifyManagement(ports: Ports) {
  return async () => {
    ports.chapterReadScope.assertStable();
    if (performance.now() >= ports.chapterReadScope.managementDeadline) return false;
    try {
      const state = await ports.chapterReadScope.page.evaluate(currentManagementDom, {
        mode: 'state' as const,
      });
      ports.chapterReadScope.assertStable();
      return (
        performance.now() < ports.chapterReadScope.managementDeadline &&
        state.allStatus === true &&
        ports.volumes.find((volume) => volume.volumeId === ports.volumeIds[0])?.name ===
          state.selectedName
      );
    } catch {
      ports.chapterReadScope.assertStable();
      return false;
    }
  };
}
