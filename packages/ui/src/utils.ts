import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * The design's font-size steps, which are NOT part of Tailwind's stock scale.
 *
 * tailwind-merge has to be told about them. Given `text-foo` it guesses which
 * group the class belongs to, and anything it does not recognise as a size it
 * files under text-colour. So `text-ui` was landing in the same group as
 * `text-btn-ink`, and since the size is emitted after the colour in every cva
 * variant, the merge dropped the colour:
 *
 *   twMerge('bg-btn text-btn-ink h-8 text-ui')
 *     → 'bg-btn h-8 text-ui'          ← the ink is gone
 *
 * which painted every solid button's label in the inherited foreground — light
 * text on a near-white button, i.e. invisible. Keep this list in step with the
 * `fontSize` block in tailwind.config.ts.
 */
const FONT_SIZES = ['meta', 'id', 'col', 'tag', 'micro', 'nav', 'ui', 'task', 'head']

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: FONT_SIZES }],
    },
  },
})

/**
 * Merge class names, with later Tailwind utilities winning over earlier ones of
 * the same kind. `cn('p-2', 'p-4')` yields 'p-4' rather than both.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
