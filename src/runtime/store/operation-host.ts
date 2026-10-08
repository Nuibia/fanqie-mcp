import { type StoreOperations } from './operations.js';
import { RuntimeError } from '../store.js';
export class StoreOperationHost {
  #operations: StoreOperations | null = null;
  protected initializeOperations(operations: StoreOperations): void {
    if (this.#operations !== null)
      throw new RuntimeError('capability_unavailable', 'Store operations are already initialized.');
    this.#operations = operations;
  }
  protected operation<K extends keyof StoreOperations>(key: K): StoreOperations[K] {
    if (!(#operations in this) || this.#operations === null)
      throw new RuntimeError('capability_unavailable', 'Store operations are unavailable.');
    return this.#operations[key];
  }
}
