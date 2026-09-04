import { Toaster } from '@pm/ui'
import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import type { ReactNode } from 'react'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' })

export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s · Admin' },
  // An internal console must never be indexed.
  robots: { index: false, follow: false, nocache: true },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  // The console is dark-only: it has no per-viewer theme to restore, so it never
  // needs the customer app's pre-hydration theme script.
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${mono.variable} font-sans antialiased`}>
        {children}
        <Toaster />
      </body>
    </html>
  )
}
