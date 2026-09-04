import { localeDirection } from '@pm/shared/constants'
import { Toaster } from '@pm/ui'
import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import type { ReactNode } from 'react'
import { QueryProvider } from '@/components/providers/query-provider'
import { ThemeScript } from '@/components/providers/theme-script'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })

// The meta typeface: every task id, count, status label and section heading is
// set in it, so it loads with the app rather than on demand.
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' })

export const metadata: Metadata = {
  title: { default: 'Project Management', template: '%s · Project Management' },
  description: 'Plan, track and deliver work across your organization.',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#09090b',
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale()
  const messages = await getMessages()
  // RTL locales flip the whole document; components use logical properties so
  // they follow automatically (§21.7).
  const dir = localeDirection(locale)

  return (
    // The palette is dark-first, so no theme attribute is the correct initial
    // state; ThemeScript only writes one when the viewer has chosen light.
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className={`${inter.variable} ${mono.variable} font-sans antialiased`}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <QueryProvider>{children}</QueryProvider>
          <Toaster />
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
