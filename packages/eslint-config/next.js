/** ESLint config for the Next.js apps. */
module.exports = {
  extends: ['./base.js', 'plugin:react/recommended', 'plugin:react-hooks/recommended', 'next/core-web-vitals'],
  settings: { react: { version: 'detect' } },
  env: { browser: true, node: true },
  rules: {
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
    // §23.2: images always go through next/image with explicit dimensions.
    '@next/next/no-img-element': 'error',
    // §13.2: never render unsanitized HTML.
    'react/no-danger': 'error',
  },
  // NOTE: the service-role client is kept out of client components by the
  // `server-only` import inside the module itself, which is a build error rather
  // than a lint warning. A blanket lint ban on *.tsx would also fire on server
  // components, where using it is correct — the customer app adds that narrower
  // restriction in its own .eslintrc.json.
}
