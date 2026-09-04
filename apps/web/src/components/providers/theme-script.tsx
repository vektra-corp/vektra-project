/**
 * Applies the stored theme before first paint.
 *
 * The palette is dark by default, so this only has to write an attribute when
 * the viewer picked light — and it has to run before React hydrates, or the
 * page flashes dark on every load for a light-theme user. A blocking inline
 * script is the only thing that runs early enough.
 */
const script = `
try {
  var t = localStorage.getItem('pm-theme');
  if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
} catch (e) {}
`

export function ThemeScript() {
  // The payload is the module constant above: no props, no user input, no
  // interpolation. It has to be inlined to run before hydration.
  // eslint-disable-next-line react/no-danger
  return <script dangerouslySetInnerHTML={{ __html: script }} />
}
