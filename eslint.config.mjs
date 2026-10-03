import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import importX from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['android/**', 'dist/**', 'eslint.config.mjs', 'ios/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  {
    files: ['benchmarks/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      'import-x/no-extraneous-dependencies': [
        'error',
        { devDependencies: ['**/*.test.ts', '**/*.config.*'] },
      ],
      'import-x/order': ['error', { alphabetize: { order: 'asc' } }],
    },
    settings: {
      'import-x/resolver-next': [createTypeScriptImportResolver()],
    },
  },
);
