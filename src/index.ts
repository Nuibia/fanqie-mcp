import { loadConfig } from './config.js';
import { createApplication } from './application.js';
import { createHttpServer } from './transport/http.js';
import { createServiceLifecycle } from './service-lifecycle.js';

const config = loadConfig();
const app = createHttpServer(config, createApplication(config));
const lifecycle = createServiceLifecycle({
  close: () => app.close(),
  abortForLeaseLoss: () => app.abortForLeaseLoss(),
  exit: (code) => process.exit(code),
  log: (message) => console.error(message),
});
app.onServiceLeaseLost(() => lifecycle.stop('lease_lost'));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => lifecycle.stop());
await app.listen();
console.error(`fanqie-mcp listening on ${config.host}:${config.port}`);
