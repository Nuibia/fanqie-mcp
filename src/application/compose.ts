import { type CoreDependencies } from './core.js';
import { type ApplicationServices } from './services.js';
import { composeIdentity } from './compose-identity.js';
import { composeEvidenceContext } from './compose-evidence-context.js';
import { composeEvidenceProjection } from './compose-evidence-projection.js';
import { composeQuery } from './compose-query.js';
import { composeCapabilities } from './compose-capabilities.js';
import { composeGenericWrite } from './compose-generic-write.js';
import { composeMaintenance } from './compose-maintenance.js';
import { composeCreationRecovery } from './compose-creation-recovery.js';
import { composeReconciliation } from './compose-reconciliation.js';
import { composeToolInput } from './compose-tool-input.js';
import { composeLifecycle } from './compose-lifecycle.js';
export function composeApplicationServices(core: CoreDependencies): ApplicationServices {
  const services = {} as ApplicationServices;
  composeIdentity(core, services);
  composeEvidenceContext(core, services);
  composeEvidenceProjection(core, services);
  composeQuery(core, services);
  composeCapabilities(core, services);
  composeGenericWrite(core, services);
  composeMaintenance(core, services);
  composeCreationRecovery(core, services);
  composeReconciliation(core, services);
  composeToolInput(core, services);
  composeLifecycle(core, services);
  return services;
}
