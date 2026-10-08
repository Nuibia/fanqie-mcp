import { fileURLToPath } from 'node:url';
import { prepareSubmissionFixtures } from './lib/submission-test-fixtures.mjs';
import {
  NATIVE_SHORT_SUBMISSION_SOURCE_PINS,
  verifyNativeShortSubmissionSources,
} from '../src/platform/short-native-submission.ts';

try {
  if (process.argv.length !== 2) throw new Error('No source overrides are supported');
  const result = await prepareSubmissionFixtures({
    directory: fileURLToPath(new URL('../test/fixtures/', import.meta.url)),
    pins: NATIVE_SHORT_SUBMISSION_SOURCE_PINS,
    verifySources: verifyNativeShortSubmissionSources,
  });
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(
    JSON.stringify({ status: 'failed', code: error.code ?? 'fixture_preparation_failed' }),
  );
  process.exitCode = 1;
}
