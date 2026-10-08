import { NativeShortCoverError } from './short-native-cover.js';

import { CODES } from './short-native-cover-image-errors.js';

type OwnedResource = { dispose: () => Promise<void>; disposal?: Promise<void> };

// Creation promises remain owned even when cancellation wins the race. Cleanup closes
// resources already obtained, then drains all late creations and operations, and waits
// for actual closes. The supplied Browser belongs to the caller and is never closed.
export class Ownership {
  readonly operations: Promise<unknown>[] = [];
  readonly creations: Promise<unknown>[] = [];
  readonly resources: OwnedResource[] = [];
  readonly stopped: Promise<never>;
  reason: NativeShortCoverError | undefined;
  private rejectStop!: (reason: NativeShortCoverError) => void;
  private closing = false;
  private cleanupFailed = false;
  private timer: ReturnType<typeof setTimeout>;
  private signal: AbortSignal | undefined;
  private abort = () => this.stop(CODES.aborted);
  constructor(signal: AbortSignal | undefined, timeoutMs: number) {
    this.stopped = new Promise<never>((_, reject) => {
      this.rejectStop = reject;
    });
    // A pre-aborted signal can reject before a race is attached.
    void this.stopped.catch(() => {});
    this.timer = setTimeout(() => this.stop(CODES.timeout), timeoutMs);
    this.signal = signal;
    if (signal) {
      EventTarget.prototype.addEventListener.call(signal, 'abort', this.abort, { once: true });
      const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!.call(
        signal,
      );
      if (aborted) this.stop(CODES.aborted);
    }
  }
  private stop(code: string) {
    if (!this.reason) {
      this.reason = new NativeShortCoverError(code);
      this.rejectStop(this.reason);
    }
  }
  check() {
    if (this.reason) throw this.reason;
  }
  async run<T>(create: () => Promise<T>): Promise<T> {
    this.check();
    const operation = Promise.resolve().then(() => {
      this.check();
      return create();
    });
    this.operations.push(operation);
    void operation.catch(() => {});
    return Promise.race([operation, this.stopped]);
  }
  async own<T>(create: () => Promise<T>, dispose: (resource: T) => Promise<void>): Promise<T> {
    this.check();
    const creation = Promise.resolve()
      .then(() => {
        this.check();
        return create();
      })
      .then((resource) => {
        const entry: OwnedResource = { dispose: () => dispose(resource) };
        this.resources.unshift(entry);
        if (this.closing) this.startClose(entry);
        return resource;
      });
    this.creations.push(creation);
    this.operations.push(creation);
    void creation.catch(() => {});
    return Promise.race([creation, this.stopped]);
  }
  private startClose(entry: OwnedResource) {
    if (!entry.disposal) {
      entry.disposal = Promise.resolve()
        .then(entry.dispose)
        .catch(() => {
          this.cleanupFailed = true;
        });
    }
  }
  async cleanup(): Promise<boolean> {
    this.closing = true;
    for (const resource of this.resources) this.startClose(resource);
    await Promise.allSettled(this.creations);
    for (const resource of this.resources) this.startClose(resource);
    await Promise.allSettled(this.resources.map((resource) => resource.disposal!));
    await Promise.allSettled(this.operations);
    clearTimeout(this.timer);
    if (this.signal)
      EventTarget.prototype.removeEventListener.call(this.signal, 'abort', this.abort);
    return this.cleanupFailed;
  }
}
