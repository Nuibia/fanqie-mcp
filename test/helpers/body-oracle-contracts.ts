import {
  type NativeShortBodyParagraphInput,
  type NativeShortBodyTrialPolicy,
} from '../../src/platform/short-native-body.js';
export interface OracleCase {
  id: string;
  sourceHtml: string;
  sourceVector: readonly NativeShortBodyParagraphInput[];
  submittedParagraphs: readonly NativeShortBodyParagraphInput[];
  trial: NativeShortBodyTrialPolicy;
  expected: {
    desiredHtml: string;
    effectiveWireLines: readonly (readonly string[])[];
    appendedWireTerminal: boolean;
    marker: {
      count: number;
      boundary: number | null;
      prefixCharacterCount?: number;
      characterCount?: number;
      eligibleParagraphCount?: number;
      percentage?: string;
      displayPercent?: number;
      class?: string;
      rawHtml?: string;
      anchorSourceIndex?: number;
    };
    exactHtmlUtf8Sha256: string;
    writePlan: { outcome: string; fixedCode: string | null; formGenerated: boolean };
  };
  notes: string;
}
