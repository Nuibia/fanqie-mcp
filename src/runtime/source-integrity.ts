import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const INVENTORY_BASIS = 'installed-handwritten-source-inventory-sha256/v1';
const REGISTRATION_BASIS = 'installed-source-registration-sha256/v1';
const CODE = /\.(?:ts|js|mjs|cjs)$/;
const MAX_FILES = 2_000;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const digest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

export class SourceIntegrityError extends Error {
  constructor() {
    super('Installed source integrity could not be verified.');
  }
}
export interface InstalledSourceInventory {
  sha256: string;
  paths: string[];
}
/** Include the complete handwritten source/test trees, so delegation and computed imports cannot hide dependencies. */
export function installedSourceInventory(
  packageRoot: string,
  mark: (input: unknown) => void = () => {},
): InstalledSourceInventory {
  const root = path.resolve(packageRoot);
  const files: [string, string][] = [];
  let totalBytes = 0;
  function visit(directory: string): void {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new SourceIntegrityError();
    const names = readdirSync(directory).sort();
    mark({ directory, names, dev: stat.dev, ino: stat.ino });
    for (const name of names) {
      const file = path.join(directory, name);
      const before = lstatSync(file);
      if (before.isSymbolicLink()) throw new SourceIntegrityError();
      if (before.isDirectory()) {
        visit(file);
        continue;
      }
      if (!CODE.test(name)) continue;
      const relative = path.relative(root, file).replaceAll(path.sep, '/');
      if (
        !/^(src|test)\/[a-zA-Z0-9/._-]+\.(?:ts|js|mjs|cjs)$/.test(relative) ||
        relative.split('/').includes('..')
      )
        throw new SourceIntegrityError();
      const metadata = (s: typeof before) => ({
        file,
        dev: s.dev,
        ino: s.ino,
        mode: s.mode,
        nlink: s.nlink,
        size: s.size,
        mtimeMs: s.mtimeMs,
        ctimeMs: s.ctimeMs,
      });
      mark(metadata(before));
      totalBytes += before.size;
      if (
        !before.isFile() ||
        before.nlink !== 1 ||
        before.size > MAX_FILE_BYTES ||
        totalBytes > MAX_TOTAL_BYTES ||
        files.length >= MAX_FILES
      )
        throw new SourceIntegrityError();
      const bytes = readFileSync(file),
        after = lstatSync(file);
      if (JSON.stringify(metadata(before)) !== JSON.stringify(metadata(after)))
        throw new SourceIntegrityError();
      const sha256 = digest(bytes);
      mark({ file, bytesHash: sha256 });
      files.push([relative, sha256]);
    }
  }
  try {
    visit(path.join(root, 'src'));
    visit(path.join(root, 'test'));
  } catch {
    throw new SourceIntegrityError();
  }
  files.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return {
    sha256: digest(JSON.stringify([INVENTORY_BASIS, files])),
    paths: files.map(([file]) => file),
  };
}
/** Historical execution inventories stay untouched; only current registration admission uses this basis. */
export function installedSourceRegistrationHash(
  entry: string,
  inventory: InstalledSourceInventory,
): string {
  if (!inventory.paths.includes(entry) || !/^[a-f0-9]{64}$/.test(inventory.sha256))
    throw new SourceIntegrityError();
  return digest(JSON.stringify([REGISTRATION_BASIS, entry, inventory.sha256]));
}
