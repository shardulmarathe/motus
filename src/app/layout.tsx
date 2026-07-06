import './globals.css'
import React from 'react'
import type { Metadata, Viewport } from 'next'
import { Analytics } from '@vercel/analytics/react'
import { Nunito, Sora, Space_Mono } from 'next/font/google'

const siteUrl = 'https://playmotus.vercel.app'

const nunito = Nunito({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
  variable: '--font-nunito',
})

const sora = Sora({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-sora',
})

const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-space-mono',
})

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Motus',
  description: 'A momentum-based platformer where precision and movement are everything.',
  alternates: {
    canonical: siteUrl,
  },
  // og:image is a screenshot of the live homepage, regenerated on every deploy
  // by scripts/capture-og.mjs -> public/og-home.png (see package.json build).
  openGraph: {
    title: 'Motus',
    description: 'A momentum-based platformer where precision and movement are everything.',
    url: siteUrl,
    type: 'website',
    siteName: 'Motus',
    images: [{ url: '/og-home.png', width: 1200, height: 630, alt: 'Motus' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Motus',
    description: 'A momentum-based platformer where precision and movement are everything.',
    images: ['/og-home.png'],
  },
  icons: {
    icon: '/favicon.svg',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#05070f',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${nunito.variable} ${sora.variable} ${spaceMono.variable}`}>
      <body className={nunito.className}>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
