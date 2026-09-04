/**
 * Side-effect stylesheet imports.
 *
 * `import './globals.css'` and `import 'react-grid-layout/css/styles.css'`
 * import nothing — the bundler extracts the stylesheet and the statement exists
 * purely for its effect. TypeScript has no idea what a `.css` file is, and Next
 * only declares the `*.module.*` patterns (in `next/types/global.d.ts`) because
 * those actually produce a value.
 *
 * Historically TypeScript let an unresolvable side-effect import pass without
 * comment, so this was silently unnecessary. `noUncheckedSideEffectImports`
 * (TS 5.6+) reports them, and editors increasingly turn it on by default — the
 * error is `TS2882: Cannot find module or type declarations for side-effect
 * import`. Declaring them is the fix; disabling the check would hide the case
 * it exists for, which is a typo'd import that silently does nothing.
 *
 * Deliberately does NOT declare `*.module.css` and friends: Next already types
 * those as the class-name map, and redeclaring them here would shadow that and
 * turn every CSS-module class into `any`.
 */

declare module '*.css'
declare module '*.scss'
declare module '*.sass'
