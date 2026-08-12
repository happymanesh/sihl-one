// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Shared lint rules for every workspace.
 *
 * Tuned to catch what TypeScript cannot, not to relitigate style. The compiler
 * already runs in strict mode across all three packages, so rules that merely
 * restate a type error are noise; what earns a place here is the class of
 * mistake that compiles cleanly and fails at runtime — a floating promise, an
 * unawaited write, an `any` that silently disables checking downstream.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/generated/**',
      '**/*.config.*',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // An unawaited database write is the bug this codebase is most exposed
      // to: services are async throughout, and a dropped await loses the write
      // with no error anywhere.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // `any` disables checking for everything downstream of it, which is how a
      // contract stops being enforced without anybody editing the contract.
      '@typescript-eslint/no-explicit-any': 'error',

      // Prefixed args are the documented way to say "deliberately unused".
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          // `const { status, attribution, ...rest } = input` destructures to
          // *omit* — the named siblings exist precisely so they do not reach
          // `rest`. Flagging them would push the codebase towards uglier
          // underscore-prefixed aliases for a deliberate, readable idiom.
          ignoreRestSiblings: true,
        },
      ],

      // Non-null assertions are load-bearing in a few places where the guard is
      // three lines up and the compiler cannot see it. Warn so they stay
      // visible without blocking a build.
      '@typescript-eslint/no-non-null-assertion': 'warn',
    },
  },
  {
    // Test files.
    //
    // `describe` and `it` from `node:test` return promises that the runner
    // owns and the caller is not meant to await, so the floating-promise rule
    // fires on every single test — hundreds of findings, none of them real.
    // Non-null assertions are likewise routine in a test that has just
    // constructed the value it is asserting on.
    files: ['**/test/**/*.ts', '**/*.test.ts', '**/*.e2e-test.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
