/** ESLint config for the customer web app. */
module.exports = {
  root: true,
  extends: ['@pm/eslint-config/next'],
  // NOTE: `parserOptions.project` is deliberately absent. Next's route groups —
  // directories like (auth) and (dashboard) — break typescript-eslint's project
  // file matching, and none of the rules configured here need type information.
  // Type errors are caught by `tsc --noEmit` in the typecheck task instead.
  overrides: [
    {
      // The service-role client has exactly one legitimate caller in this app:
      // the Stripe webhook route, which is a .ts file. Any .tsx reaching for it
      // is a mistake. (`server-only` inside the module is the hard gate; this is
      // the early warning.)
      files: ['src/**/*.tsx'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/lib/supabase/admin', '@/lib/supabase/admin'],
                message:
                  'The service-role client bypasses RLS and belongs in webhooks and jobs only (claude.md §13.10).',
              },
            ],
          },
        ],
      },
    },
  ],
}
