// @ts-check
import base from '../../eslint.config.base.mjs';
import tseslint from 'typescript-eslint';

/**
 * The type-aware rules need a program for *every* file they lint, tests
 * included — scoping `parserOptions` to `src` alone makes them throw on the
 * test files rather than skip them, which reads as a broken config.
 */
export default tseslint.config(...base, {
  files: ['**/*.ts'],
  languageOptions: {
    parserOptions: {
      project: './tsconfig.eslint.json',
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    // Nest decorators legitimately produce classes with no own members.
    '@typescript-eslint/no-extraneous-class': 'off',
  },
});
