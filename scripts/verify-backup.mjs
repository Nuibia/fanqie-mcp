#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackupError, runVerifyBackup } from './lib/backup-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--archive'))
    throw new BackupError('unexpected_arguments');
  const result = await runVerifyBackup({ projectRoot: root, archiveArgument: args[1] });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({ pass: false, code: error instanceof BackupError ? error.code : 'backup_verification_failed' })}\n`,
  );
  process.exitCode = 1;
}
