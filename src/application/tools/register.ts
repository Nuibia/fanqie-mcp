import { type CoreDependencies } from '../core.js';
import { type ApplicationServices } from '../services.js';
import { registerUploadCover } from './register-upload-cover.js';
import { registerDiagnoseReadPage } from './register-diagnose-read-page.js';
import { registerGetShortMetadataSnapshot } from './register-get-short-metadata-snapshot.js';
import { registerGetSavedSnapshot } from './register-get-saved-snapshot.js';
import { registerGetChapter } from './register-get-chapter.js';
import { registerReconcileWrite } from './register-reconcile-write.js';
import { registerSaveChapterDraft } from './register-save-chapter-draft.js';
export function registerApplicationTools(
  core: CoreDependencies,
  services: ApplicationServices,
): void {
  registerUploadCover(core, services);
  registerDiagnoseReadPage(core, services);
  registerGetShortMetadataSnapshot(core, services);
  registerGetSavedSnapshot(core, services);
  registerGetChapter(core, services);
  registerReconcileWrite(core, services);
  registerSaveChapterDraft(core, services);
}
