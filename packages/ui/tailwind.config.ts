import type { Config } from 'tailwindcss'

/**
 * Base Tailwind config, extended by each app.
 *
 * Colours are declared as CSS variables so the same class names work in light
 * and dark mode, and so an org could be given a themed accent later without
 * touching component code. The palette is dark-first (see styles.css).
 */
const config: Omit<Config, 'content'> = {
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        'border-subtle': 'hsl(var(--border-subtle))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        /* Panel elevation ladder: canvas → surface → raised → overlay. */
        surface: {
          DEFAULT: 'hsl(var(--surface))',
          raised: 'hsl(var(--surface-raised))',
          hover: 'hsl(var(--surface-hover))',
          overlay: 'hsl(var(--surface-overlay))',
        },
        /* Third and fourth text tiers, below muted-foreground. */
        faint: 'hsl(var(--faint))',
        subtle: 'hsl(var(--subtle))',
        track: 'hsl(var(--track))',
        /* Recessed wells: inputs, search fields, mini-view tiles. */
        sunk: 'hsl(var(--sunk))',
        /* Neutral fill for count pills, avatars and inert chips. */
        chip: 'hsl(var(--chip))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        /*
         * The solid action button. On dark it is near-white on near-black, not
         * the teal accent — teal is reserved for state and emphasis, so a page
         * full of primary buttons does not read as a page full of alerts.
         */
        btn: {
          DEFAULT: 'hsl(var(--btn))',
          ink: 'hsl(var(--btn-ink))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        brand: {
          DEFAULT: 'hsl(var(--brand))',
          from: 'hsl(var(--brand-from))',
          to: 'hsl(var(--brand-to))',
        },
        /* The wash behind a modal or the command palette. */
        scrim: 'hsl(var(--scrim))',
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        danger: 'hsl(var(--danger))',
        // Semantic colours for task priority and status pills.
        priority: {
          critical: 'hsl(var(--priority-critical))',
          high: 'hsl(var(--priority-high))',
          medium: 'hsl(var(--priority-medium))',
          low: 'hsl(var(--priority-low))',
        },
        // Kanban column accents, keyed by workflow stage rather than by name so
        // a renamed column keeps its colour.
        status: {
          backlog: 'hsl(var(--status-backlog))',
          progress: 'hsl(var(--status-progress))',
          testing: 'hsl(var(--status-testing))',
          review: 'hsl(var(--status-review))',
          done: 'hsl(var(--status-done))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontSize: {
        /*
         * The design's own steps. Named so components stop hand-rolling
         * arbitrary bracket sizes that drift apart over time.
         *
         * None of these may reuse a colour token name: `text-*` resolves both
         * scales, and a collision silently wins for colour — `text-card` would
         * paint a title in the card's own background and render it invisible.
         * Hence `task` and `tag` rather than `card` and `chip`.
         */
        meta: ['9px', { lineHeight: '1' }],
        id: ['9.5px', { lineHeight: '1' }],
        col: ['10px', { lineHeight: '1' }],
        tag: ['10.5px', { lineHeight: '1.2' }],
        micro: ['11.5px', { lineHeight: '1.3' }],
        nav: ['12px', { lineHeight: '1.3' }],
        ui: ['12.5px', { lineHeight: '1.35' }],
        base: ['13px', { lineHeight: '1.45' }],
        task: ['13.5px', { lineHeight: '1.35' }],
        head: ['18px', { lineHeight: '1.25' }],
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        /*
         * The nav's geometric glyphs (◍ ⋔ ⬔ ▦). Inter covers Geometric Shapes
         * but not all of Miscellaneous Symbols and Arrows, and an uncovered
         * glyph renders as tofu rather than falling back, so the faces that do
         * carry the block are put ahead of it.
         */
        glyph: [
          'Segoe UI Symbol',
          'Apple Symbols',
          'Noto Sans Symbols 2',
          'var(--font-sans)',
          'sans-serif',
        ],
      },
      boxShadow: {
        // The design keeps resting surfaces flat and separates them with a
        // hairline instead of a shadow; only things that genuinely float —
        // menus, dialogs, a card under the cursor — cast one.
        card: 'none',
        raised: '0 14px 34px rgb(0 0 0 / 0.32)',
        overlay: '0 18px 44px rgb(0 0 0 / 0.4)',
        drag: '0 20px 44px -12px rgb(0 0 0 / 0.75)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'overlay-in': {
          from: { opacity: '0', transform: 'translateY(4px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        /*
         * A card landing after a drag. The design's own curve: it arrives a
         * touch small, overshoots, and settles while a teal ring expands out of
         * it — so your eye is told where the card went without the board having
         * to move anything else.
         */
        'card-drop': {
          '0%': {
            transform: 'scale(0.955)',
            boxShadow: '0 0 0 0 hsl(var(--primary) / 0.5)',
          },
          '55%': {
            transform: 'scale(1.022)',
            boxShadow: '0 0 0 6px hsl(var(--primary) / 0.14)',
          },
          '100%': {
            transform: 'scale(1)',
            boxShadow: '0 0 0 12px hsl(var(--primary) / 0)',
          },
        },
        /* The gap that opens where a dragged card would land. */
        'drop-slot': {
          from: { opacity: '0', transform: 'scaleY(0.6)' },
          to: { opacity: '1', transform: 'scaleY(1)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in': 'fade-in 0.15s ease-out',
        'overlay-in': 'overlay-in 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
        'card-drop': 'card-drop 420ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        'drop-slot': 'drop-slot 120ms ease-out',
      },
    },
  },
  plugins: [],
}

export default config
