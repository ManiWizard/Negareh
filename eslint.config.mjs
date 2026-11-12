// Owns frontend correctness rules; type-aware checks run only on project TypeScript.
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig({
  files: ['src/**/*.ts'],
  extends: [tseslint.configs.strictTypeChecked],
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    'max-depth': ['error', 3],
    'no-else-return': ['error', { allowElseIf: false }],
    '@typescript-eslint/no-floating-promises': ['error', { ignoreVoid: false }],
    '@typescript-eslint/switch-exhaustiveness-check': 'error',
  },
});
