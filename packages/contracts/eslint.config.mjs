// @ts-check
import base from '../../eslint.config.base.mjs';
import tseslint from 'typescript-eslint';

/**
 * The contracts package is type-aware linted: it holds every business rule, so
 * a floating promise or a silently-widened type here reaches both apps.
 */
export default tseslint.config(...base, {
  files: ['src/**/*.ts', 'test/**/*.ts'],
  languageOptions: {
    parserOptions: {
      // A lint-only project: the build tsconfig excludes tests so they are not
      // emitted into dist, but the type-aware rules still need them compiled.
      project: './tsconfig.eslint.json',
      tsconfigRootDir: import.meta.dirname,
    },
  },
});
