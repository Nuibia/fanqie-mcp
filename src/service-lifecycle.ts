/** Process-only shutdown coordination. No database, account, platform or public control surface. */
export const SERVICE_FATAL_TIMEOUT_MS = 120_000;

export function createServiceLifecycle(dependencies: {
  close(): Promise<void>;
  abortForLeaseLoss(): void;
  exit(code: 0 | 1): void;
  log(message: string): void;
  /** Synthetic tests may shorten the deadline; production uses the fixed default. */
  fatalTimeoutMs?: number;
}) {
  const timeoutMs = dependencies.fatalTimeoutMs ?? SERVICE_FATAL_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647)
    throw new Error('Invalid fatal shutdown deadline.');
  let fatal = false,
    finished = false;
  let closing: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const log = (message: string) => {
    try {
      dependencies.log(message);
    } catch {
      /* Logging cannot prevent termination. */
    }
  };
  const finish = (code: 0 | 1) => {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);
    dependencies.exit(code);
  };
  return {
    stop(reason: 'normal' | 'lease_lost' = 'normal'): void {
      if (finished) return;
      if (reason === 'lease_lost' && !fatal) {
        fatal = true;
        timer = setTimeout(() => {
          log('service_fatal_deadline');
          finish(1);
        }, timeoutMs);
        // Upgrade even when a normal stop already owns the one pending close promise.
        try {
          dependencies.abortForLeaseLoss();
        } catch {
          log('service_cleanup_incomplete');
        }
        log('service_lease_lost');
      }
      if (closing) return;
      closing = Promise.resolve().then(() => dependencies.close());
      void closing.then(
        () => finish(fatal ? 1 : 0),
        () => {
          log('service_cleanup_incomplete');
          // Fatal partial cleanup must wait for the overall deadline rather than claim release.
          if (!fatal) finish(1);
        },
      );
    },
  };
}
