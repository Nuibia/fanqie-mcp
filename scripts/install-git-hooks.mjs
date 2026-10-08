import { existsSync } from 'node:fs';

// Source archives and production-only installs do not need development hooks.
if (process.env.CI !== 'true' && process.env.NODE_ENV !== 'production' && existsSync('.git')) {
  const { default: husky } = await import('husky');
  const error = husky();
  if (error) {
    process.stderr.write(`${error}\n`);
    process.exitCode = 1;
  }
}
