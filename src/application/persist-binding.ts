import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { Store, RuntimeError } from '../runtime/store.js';
import { AccountBinding } from './shared.js';
import { type PersistBindingOperation } from './contracts/identity.js';

interface Dependencies {
  store: Store;
  bindingFile: string;
  bound: AccountBinding | undefined;
}

export function createPersistBinding(deps: Dependencies): PersistBindingOperation {
  function persistBinding(next: AccountBinding) {
    deps.store.assertPublicReadMutationAllowed();
    const temporary = `${deps.bindingFile}.${randomUUID()}.tmp`;
    let descriptor: number | undefined;
    try {
      descriptor = openSync(temporary, 'wx', 0o600);
      writeFileSync(descriptor, JSON.stringify(next));
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporary, deps.bindingFile);
      const directory = openSync(path.dirname(deps.bindingFile), 'r');
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
      deps.bound = next;
    } catch {
      if (descriptor !== undefined) closeSync(descriptor);
      if (existsSync(temporary)) unlinkSync(temporary);
      throw new RuntimeError(
        'binding_persistence_failed',
        'The verified account binding could not be saved',
      );
    }
  }
  return persistBinding;
}
