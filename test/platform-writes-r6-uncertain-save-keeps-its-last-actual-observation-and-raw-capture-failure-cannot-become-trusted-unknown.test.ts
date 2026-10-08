import test from 'node:test';

import {
  NativeShortFixturePage,
  nativeShortProfile,
} from './helpers/platform-writes-native-short-fixture-page.js';

import {
  type GenericShortObservation,
  updateDraft,
  isGenericShortCaptureFailure,
  prepareSubmission,
  submitShortStory,
  reconcileWrite,
  hashDraftContent,
  readWriteSnapshot,
} from '../src/platform/writes.js';

import {
  nativeUpdateInput,
  nativeOptions,
  legacyNativeReadInput,
  nativeContent,
} from './helpers/platform-writes-fixture-template-document.js';

import assert from 'node:assert/strict';

import { accountId, target, rejectsCode } from './helpers/platform-writes-fixture-page.js';

test('R6 uncertain save keeps its last actual observation and raw capture failure cannot become trusted unknown', async () => {
  const page = new NativeShortFixturePage(),
    seen: GenericShortObservation[] = [];
  page.onReopen = () => {
    if (page.clicks.length) {
      page.statusOverride = 1;
      page.displayStatusOverride = 10;
    }
  };
  const result = await updateDraft(page.asPage(), nativeUpdateInput(), {
    ...nativeOptions,
    profile: nativeShortProfile,
    timeoutMs: 150,
    onShortObservation: async (observation) => {
      seen.push(observation);
    },
  });
  assert.equal(result.status, 'uncertain');
  assert.equal(result.platformState, undefined);
  assert.equal(result.statusProtocol, 'fanqie-generic-short-status/v1');
  assert.equal(result.shortObservation?.phase, 'after');
  assert.equal(result.shortObservation?.snapshot.state, 'waiting_publication');
  assert.deepEqual(result.shortObservation, seen[1]);
  assert.deepEqual(page.clicks, ['button:存草稿']);
  assert.equal(page.gotoCalls.length, 2);
  page.cleanup();
  const noAck = new NativeShortFixturePage();
  noAck.suppressDefaultAck = true;
  const unknown = await updateDraft(noAck.asPage(), nativeUpdateInput(), {
    ...nativeOptions,
    profile: nativeShortProfile,
    timeoutMs: 35,
  });
  assert.equal(unknown.status, 'uncertain');
  assert.equal(unknown.shortObservation?.phase, 'baseline');
  assert.equal(noAck.gotoCalls.length, 1);
  assert.deepEqual(noAck.clicks, ['button:存草稿']);
  noAck.cleanup();
  const invalid = new NativeShortFixturePage();
  let invoked = 0;
  invalid.rawResponseTransform = (raw) => {
    if (invalid.clicks.length)
      Object.defineProperty((raw as { data: object }).data, 'content', {
        get() {
          invoked++;
          return '<p>unsafe</p>';
        },
        enumerable: true,
      });
    return raw;
  };
  await assert.rejects(
    updateDraft(invalid.asPage(), nativeUpdateInput(), {
      ...nativeOptions,
      profile: nativeShortProfile,
      timeoutMs: 150,
    }),
    (error) => isGenericShortCaptureFailure(error),
  );
  assert.equal(invoked, 0);
  assert.deepEqual(invalid.clicks, ['button:存草稿']);
  assert.equal(invalid.gotoCalls.length, 2);
  invalid.cleanup();
});

test('R6 native submission stays in legacy authority with no generic observation or transient markers', async () => {
  const page = new NativeShortFixturePage();
  let callbacks = 0;
  const runOptions = {
    ...nativeOptions,
    profile: nativeShortProfile,
    timeoutMs: 100,
    onShortObservation: async () => {
      callbacks++;
    },
  };
  const prepared = await prepareSubmission(page.asPage(), legacyNativeReadInput(), runOptions);
  assert.equal(prepared.expectedState, 'draft');
  assert.equal(callbacks, 0);
  assert.deepEqual(page.clicks, []);
  page.onReopen = () => {
    if (page.clicks.includes('button:确认提交')) {
      page.statusOverride = 1;
      page.displayStatusOverride = 4;
    }
  };
  const result = await submitShortStory(
    page.asPage(),
    { ...legacyNativeReadInput(), prepared, acceptPublicationTerms: true },
    runOptions,
  );
  assert.equal(result.status, 'succeeded');
  assert.equal(result.platformState, 'reviewing');
  assert.equal(callbacks, 0);
  assert.equal(Object.hasOwn(result, 'statusProtocol'), false);
  assert.equal(Object.hasOwn(result, 'shortObservation'), false);
  assert.deepEqual(page.clicks, ['button:下一步', 'button:确认提交']);
  assert.equal(page.gotoCalls.length, 3);
  page.cleanup();
});

test('R6 native pure reconciliation cannot promote publication or matching content into a save ACK', async () => {
  const page = new NativeShortFixturePage();
  let callbacks = 0;
  const result = await reconcileWrite(
    page.asPage(),
    {
      accountId,
      capability: 'update_draft',
      target,
      expectedContentHash: hashDraftContent(nativeContent),
      expectedStates: ['draft'],
    },
    {
      ...nativeOptions,
      profile: nativeShortProfile,
      timeoutMs: 100,
      onShortObservation: async () => {
        callbacks++;
      },
    },
  );
  assert.equal(result.status, 'uncertain');
  assert.equal(result.platformState, undefined);
  assert.equal(result.contentHash, undefined);
  assert.equal(callbacks, 0);
  assert.equal(page.gotoCalls.length, 1);
  assert.deepEqual(page.fills, []);
  assert.deepEqual(page.clicks, []);
  page.cleanup();
});

test('R6 original request identity, method, main frame and single GET/response bounds remain mandatory', async () => {
  for (const variant of [
    'same-request-twice',
    'same-response-twice',
    'wrong-method',
    'wrong-frame',
  ] as const) {
    const page = new NativeShortFixturePage(),
      emit = page.emit.bind(page);
    page.emit = (name, value) => {
      if (name === 'request' && variant === 'same-request-twice') {
        emit(name, value);
        emit(name, value);
        return;
      }
      if (name === 'response' && variant === 'same-response-twice') {
        emit(name, value);
        emit(name, value);
        return;
      }
      if (name === 'request' && (variant === 'wrong-method' || variant === 'wrong-frame')) {
        Object.assign(
          value as object,
          variant === 'wrong-method' ? { method: () => 'POST' } : { frame: () => ({}) },
        );
      }
      emit(name, value);
    };
    await assert.rejects(
      readWriteSnapshot(page.asPage(), accountId, target, {
        ...nativeOptions,
        profile: nativeShortProfile,
        timeoutMs: 35,
      }),
      rejectsCode('capability_unavailable'),
    );
    assert.equal(page.gotoCalls.length, 1);
    assert.deepEqual(page.fills, []);
    assert.deepEqual(page.clicks, []);
    assert.equal(
      [...page.nativeEvents.values()].every((entries) => entries.size === 0),
      true,
    );
    page.cleanup();
  }
});
