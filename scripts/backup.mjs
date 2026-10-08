#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackupError, runBackup } from './lib/backup-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abort = new AbortController();
const cancel = () => abort.abort();
process.on('SIGINT', cancel);
process.on('SIGTERM', cancel);
try {
  if (process.argv.length !== 2) throw new BackupError('unexpected_arguments');
  const result = await runBackup({ projectRoot: root, signal: abort.signal });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ pass: false, code: error instanceof BackupError ? error.code : 'backup_failed' })}\n`,
  );
  process.exitCode = 1;
} finally {
  process.off('SIGINT', cancel);
  process.off('SIGTERM', cancel);
}
