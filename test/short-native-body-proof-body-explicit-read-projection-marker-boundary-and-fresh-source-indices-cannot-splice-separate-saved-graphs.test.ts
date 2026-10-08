import test from 'node:test';

import { physicalReadFixture } from './helpers/short-native-body-proof-independent-reconciliation.js';

import { projectNativeShortBodyReadContext } from '../src/platform/short-native-body-runtime.js';

import assert from 'node:assert/strict';

import { sha, BASES, BINDING } from './helpers/short-native-body-proof-utf16.js';

test('body explicit read projection marker boundary and fresh source indices cannot splice separate saved graphs', () => {
  const marker =
    '<div data-percentage="0.3" data-fanqie-type="pay_tag" data-min-text="200" data-min-paragraphs="3" data-min-radio="0.3" data-para-nums="3" class="fq-pay-node-animation"></div>';
  const a = '甲'.repeat(90),
    b = '乙'.repeat(60),
    c = '丙'.repeat(150),
    content = `<p>${a}</p>${marker}<p>${b}</p><p>${c}</p><p></p>`;
  const first = physicalReadFixture(content),
    second = physicalReadFixture('<p>NEW_CURRENT_BODY</p><p></p>');
  try {
    const projection = projectNativeShortBodyReadContext(first.context());
    assert.deepEqual(projection.paragraphs, [
      { sourceIndex: 0, lines: [a] },
      { sourceIndex: 1, lines: [b] },
      { sourceIndex: 2, lines: [c] },
      { sourceIndex: 3, lines: [''] },
    ]);
    assert.deepEqual(projection.marker, {
      boundary: 1,
      markerCount: 1,
      paragraphCount: 4,
      eligibleParagraphCount: 3,
      characterCount: 300,
      prefixCharacterCount: 90,
      displayPercent: 30,
    });
    assert.equal(
      projection.markerHash,
      sha({
        basis: BASES.marker,
        binding: BINDING,
        marker: {
          rawHtml: marker,
          boundary: 1,
          attrs: {
            'data-percentage': '0.3',
            'data-fanqie-type': 'pay_tag',
            'data-min-text': '200',
            'data-min-paragraphs': '3',
            'data-min-radio': '0.3',
            'data-para-nums': '3',
            class: 'fq-pay-node-animation',
          },
        },
      }),
    );
    const current = projectNativeShortBodyReadContext(second.context());
    assert.notEqual(current.sourceRef, projection.sourceRef);
    assert.equal(current.paragraphs[0]!.lines[0], 'NEW_CURRENT_BODY');
    assert.notEqual(current.snapshotVersionHash, projection.snapshotVersionHash);
    const spliced = first.context();
    spliced.document = second.context().document;
    assert.throws(() => projectNativeShortBodyReadContext(spliced));
  } finally {
    first.close();
    second.close();
  }
});
