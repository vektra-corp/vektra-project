/** Shared base ESLint config. Enforces the rules in claude.md §16 and §13. */
module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier',
  ],
  env: { es2022: true, node: true },
  settings: {
    'import/resolver': {
      typescript: { alwaysTryTypes: true, project: ['./tsconfig.json'] },
    },
  },
  rules: {
    // §16: no `any`. Use `unknown` and narrow.
    '@typescript-eslint/no-explicit-any': 'error',
    // §16: no @ts-ignore without an explanation.
    '@typescript-eslint/ban-ts-comment': [
      'error',
      { 'ts-ignore': 'allow-with-description', 'ts-expect-error': 'allow-with-description' },
    ],
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/consistent-type-imports': [
      'error',
      { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
    ],
    // §16: prefer `interface` for object shapes.
    '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    eqeqeq: ['error', 'always', { null: 'ignore' }],
    'import/order': [
      'warn',
      {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        'newlines-between': 'never',
        alphabetize: { order: 'asc', caseInsensitive: true },
      },
    ],
    // §3: date handling uses date-fns; moment.js is banned outright.
    'no-restricted-imports': [
      'error',
      {
        paths: [
          { name: 'moment', message: 'Use date-fns (claude.md §3).' },
          {
            name: 'dompurify',
            message: 'Use isomorphic-dompurify via @pm/shared/utils (claude.md §13.1).',
          },
        ],
      },
    ],
  },
  ignorePatterns: ['node_modules/', 'dist/', '.next/', '.turbo/', '*.config.js', '*.config.mjs'],
}
