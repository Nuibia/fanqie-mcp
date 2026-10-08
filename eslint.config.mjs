import parser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier/flat';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      '.runtime/**',
      '.secrets/**',
      '.openai/**',
      'data/**',
      'profile/**',
      'artifacts/**',
      'logs/**',
      'playwright-report/**',
      'test-results/**',
      '.auth/**',
    ],
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      'max-lines': ['error', { max: 500, skipBlankLines: false, skipComments: false }],
      'no-debugger': 'error',
      'no-var': 'error',
      'no-duplicate-imports': ['error', { allowSeparateTypeImports: true }],
    },
  },
  { files: ['**/*.{ts,mts,cts}'], languageOptions: { parser } },
  { files: ['**/*.cjs'], languageOptions: { sourceType: 'commonjs' } },
  prettier,
];
