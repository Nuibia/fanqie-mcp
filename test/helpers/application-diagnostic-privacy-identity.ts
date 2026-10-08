import assert from 'node:assert/strict';

export interface DiagnosticPrivacyIdentity {
  jobId: string;
  status: string;
  operation: string;
  requestedAt: string;
  endedAt: string | null;
  refs: Array<{ id: string; sha256: string; dataset: string; capturedAt: string }>;
}

export const DIAGNOSTIC_PRIVACY_FIELDS = [
  {
    field: 'category',
    present: true,
    type: 'array',
    arrayCount: 1,
    truncated: false,
    categorySamples: [
      {
        type: 'object',
        fields: [
          { field: 'category_id', type: 'string' },
          { field: 'label', type: 'string' },
          { field: 'name', type: 'string' },
        ],
      },
    ],
  },
  {
    field: 'thumb_uri',
    present: true,
    type: 'string',
    arrayCount: null,
    truncated: false,
    categorySamples: [],
  },
  {
    field: 'thumb_url_list',
    present: false,
    type: 'absent',
    arrayCount: null,
    truncated: false,
    categorySamples: [],
  },
  {
    field: 'book_thumb_uri',
    present: false,
    type: 'absent',
    arrayCount: null,
    truncated: false,
    categorySamples: [],
  },
  {
    field: 'book_thumb_url_list',
    present: false,
    type: 'absent',
    arrayCount: null,
    truncated: false,
    categorySamples: [],
  },
] as const;

export function diagnosticPrivacyExact(
  input: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  assert(input && typeof input === 'object' && !Array.isArray(input));
  assert.equal(Object.getPrototypeOf(input), Object.prototype);
  assert.equal(Object.getOwnPropertySymbols(input).length, 0);
  const descriptors = Object.getOwnPropertyDescriptors(input);
  assert.deepEqual(Object.keys(descriptors).sort(), [...keys].sort());
  for (const descriptor of Object.values(descriptors)) {
    assert.equal(descriptor.enumerable, true);
    assert.equal(Object.hasOwn(descriptor, 'value'), true);
  }
  return input as Record<string, unknown>;
}

export function diagnosticPrivacyTree(input: unknown): void {
  const active = new Set<object>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object') {
      assert(['string', 'number', 'boolean'].includes(typeof value) || value === null);
      if (typeof value === 'number') assert(Number.isFinite(value));
      return;
    }
    assert.equal(active.has(value), false);
    active.add(value);
    assert.equal(Object.getOwnPropertySymbols(value).length, 0);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Array.isArray(value)) {
      assert.equal(Object.getPrototypeOf(value), Array.prototype);
      assert.deepEqual(
        Object.keys(descriptors).sort(),
        ['length', ...Array.from({ length: value.length }, (_, index) => String(index))].sort(),
      );
      for (let index = 0; index < value.length; index++) {
        const descriptor = descriptors[String(index)];
        assert(descriptor);
        assert.equal(descriptor.enumerable, true);
        assert.equal(Object.hasOwn(descriptor, 'value'), true);
        visit(descriptor.value);
      }
    } else {
      assert.equal(Object.getPrototypeOf(value), Object.prototype);
      for (const descriptor of Object.values(descriptors)) {
        assert.equal(descriptor.enumerable, true);
        assert.equal(Object.hasOwn(descriptor, 'value'), true);
        visit(descriptor.value);
      }
    }
    active.delete(value);
  };
  visit(input);
}

export function diagnosticPrivacyTime(value: unknown): string {
  assert(typeof value === 'string');
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value));
  assert(Number.isFinite(Date.parse(value)));
  assert.equal(new Date(value).toISOString(), value);
  return value;
}
