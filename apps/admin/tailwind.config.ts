import type { Config } from 'tailwindcss'
import base from '@pm/ui/tailwind'

export default {
  ...base,
  content: ['./src/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
} satisfies Config
