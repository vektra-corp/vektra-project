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
        /* Third text tier, below muted-foreground. */
        faint: 'hsl(var(--faint))',
        track: 'hsl(var(--track))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
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
          review: 'hsl(var(--status-review))',
          done: 'hsl(var(--status-done))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        // Dark surfaces need a hairline highlight rather than a drop shadow to
        // read as raised, so every elevation pairs an inset top edge with depth.
        card: '0 1px 2px 0 rgb(0 0 0 / 0.4), inset 0 1px 0 0 rgb(255 255 255 / 0.03)',
        raised: '0 4px 12px -2px rgb(0 0 0 / 0.5), inset 0 1px 0 0 rgb(255 255 255 / 0.04)',
        overlay: '0 16px 40px -8px rgb(0 0 0 / 0.65), inset 0 1px 0 0 rgb(255 255 255 / 0.05)',
        drag: '0 20px 44px -12px rgb(0 0 0 / 0.75), inset 0 1px 0 0 rgb(255 255 255 / 0.06)',
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
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in': 'fade-in 0.15s ease-out',
        'overlay-in': 'overlay-in 0.15s cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
}

export default config
