import { type OracleCase } from './body-oracle-contracts.js';

import {
  type NativeShortBodyParagraphInput,
  type NativeShortBodyTrialPolicy,
} from '../../src/platform/short-native-body.js';
export const bodyOracle0: readonly OracleCase[] = [
  {
    id: 'O01 raw entity / three BR token byte round-trip',
    sourceHtml: '<p>A&amp;B<br />&#65;&#x42;<br/>C<br>D&nbsp;&quot;&apos;</p><p></p>',
    sourceVector: [
      {
        sourceIndex: 0,
        lines: ['A&B', 'AB', 'C', 'D "\''],
      },
      {
        sourceIndex: 1,
        lines: [''],
      },
    ],
    submittedParagraphs: [
      {
        sourceIndex: 0,
        lines: ['A&B', 'AB', 'C', 'D "\''],
      },
      {
        sourceIndex: 1,
        lines: [''],
      },
    ],
    trial: {
      action: 'preserve',
    },
    expected: {
      desiredHtml: '<p>A&amp;B<br />&#65;&#x42;<br/>C<br>D&nbsp;&quot;&apos;</p><p></p>',
      effectiveWireLines: [['A&B', 'AB', 'C', 'D "\''], ['']],
      appendedWireTerminal: false,
      marker: {
        count: 0,
        boundary: null,
      },
      exactHtmlUtf8Sha256: '5fa823d65bf49b3abf6e2dc89f7ac17ba4fdb89ade3386cce7bead6932f43b36',
      writePlan: {
        outcome: 'reject',
        fixedCode: 'no_change',
        formGenerated: false,
      },
    },
    notes: '原实体十进制/十六进制拼法与三种BR原样保留；NBSP不trim。',
  },

  {
    id: 'O02 literal source LF is a two-line vector',
    sourceHtml: '<p>甲\n乙</p><p></p>',
    sourceVector: [
      {
        sourceIndex: 0,
        lines: ['甲', '乙'],
      },
      {
        sourceIndex: 1,
        lines: [''],
      },
    ],
    submittedParagraphs: [
      {
        sourceIndex: 0,
        lines: ['甲', '乙'],
      },
      {
        sourceIndex: 1,
        lines: [''],
      },
    ],
    trial: {
      action: 'preserve',
    },
    expected: {
      desiredHtml: '<p>甲\n乙</p><p></p>',
      effectiveWireLines: [['甲', '乙'], ['']],
      appendedWireTerminal: false,
      marker: {
        count: 0,
        boundary: null,
      },
      exactHtmlUtf8Sha256: 'cfabe8a804ddc7f1d882c03f3dc8770113b3aea4db0585910c2f3863b28dab4e',
      writePlan: {
        outcome: 'reject',
        fixedCode: 'no_change',
        formGenerated: false,
      },
    },
    notes:
      'source里真LF已有相同两line语义时保留真LF原字节，不改成BR。submitted单一line含LF另须拒绝。',
  },

  {
    id: 'O03 zero terminal empty p requires explicit wire append',
    sourceHtml: '<p>甲</p>',
    sourceVector: [
      {
        sourceIndex: 0,
        lines: ['甲'],
      },
    ],
    submittedParagraphs: [
      {
        sourceIndex: 0,
        lines: ['甲'],
      },
    ],
    trial: {
      action: 'clear',
    },
    expected: {
      desiredHtml: '<p>甲</p><p></p>',
      effectiveWireLines: [['甲'], ['']],
      appendedWireTerminal: true,
      marker: {
        count: 0,
        boundary: null,
      },
      exactHtmlUtf8Sha256: 'b786a99412515b78cf652797135841c86461c6797ea77cc6d84519fa8f7da2b3',
      writePlan: {
        outcome: 'plan',
        fixedCode: null,
        formGenerated: true,
      },
    },
    notes: '提交1段，源1段，effective wire2段；wire补段不是悄悄回填submitted。',
  },

  {
    id: 'O04 one terminal empty p remains one',
    sourceHtml: '<p>甲</p><p></p>',
    sourceVector: [
      {
        sourceIndex: 0,
        lines: ['甲'],
      },
      {
        sourceIndex: 1,
        lines: [''],
      },
    ],
    submittedParagraphs: [
      {
        sourceIndex: 0,
        lines: ['甲'],
      },
      {
        sourceIndex: 1,
        lines: [''],
      },
    ],
    trial: {
      action: 'preserve',
    },
    expected: {
      desiredHtml: '<p>甲</p><p></p>',
      effectiveWireLines: [['甲'], ['']],
      appendedWireTerminal: false,
      marker: {
        count: 0,
        boundary: null,
      },
      exactHtmlUtf8Sha256: 'b786a99412515b78cf652797135841c86461c6797ea77cc6d84519fa8f7da2b3',
      writePlan: {
        outcome: 'reject',
        fixedCode: 'no_change',
        formGenerated: false,
      },
    },
    notes: '已有精确尾空p，不再补；无marker的preserve不创建marker。',
  },

  {
    id: 'O05 many empty paragraphs and BR-only p remain distinct',
    sourceHtml: '<p>甲</p><p><br /></p><p></p><p></p>',
    sourceVector: [
      {
        sourceIndex: 0,
        lines: ['甲'],
      },
      {
        sourceIndex: 1,
        lines: ['', ''],
      },
      {
        sourceIndex: 2,
        lines: [''],
      },
      {
        sourceIndex: 3,
        lines: [''],
      },
    ],
    submittedParagraphs: [
      {
        sourceIndex: 0,
        lines: ['甲'],
      },
      {
        sourceIndex: 1,
        lines: ['', ''],
      },
      {
        sourceIndex: 2,
        lines: [''],
      },
      {
        sourceIndex: 3,
        lines: [''],
      },
    ],
    trial: {
      action: 'clear',
    },
    expected: {
      desiredHtml: '<p>甲</p><p><br /></p><p></p><p></p>',
      effectiveWireLines: [['甲'], ['', ''], [''], ['']],
      appendedWireTerminal: false,
      marker: {
        count: 0,
        boundary: null,
      },
      exactHtmlUtf8Sha256: '1637201cb2dceeabd88bd9735e1f82e6d8f31b1fd8c593aae895e80bb2435e29',
      writePlan: {
        outcome: 'reject',
        fixedCode: 'no_change',
        formGenerated: false,
      },
    },
    notes: '四个actual p均保留；BR-only不是<p></p>，两个尾空p不合并。',
  },

  {
    id: 'O06 empty readable source and one explicit blank write paragraph',
    sourceHtml: '',
    sourceVector: [],
    submittedParagraphs: [
      {
        sourceIndex: null,
        lines: [''],
      },
    ],
    trial: {
      action: 'clear',
    },
    expected: {
      desiredHtml: '<p></p>',
      effectiveWireLines: [['']],
      appendedWireTerminal: false,
      marker: {
        count: 0,
        boundary: null,
      },
      exactHtmlUtf8Sha256: 'fe04a9dc88d3f3be8d4f6bc63a9a80f45a4c6d8460e7551dab849457c091920a',
      writePlan: {
        outcome: 'plan',
        fixedCode: null,
        formGenerated: true,
      },
    },
    notes:
      'read sourceVector=[]可成功；write submitted=[]必须拒绝。此1个全空p只代表draft，不代表可投稿。',
  },
];
