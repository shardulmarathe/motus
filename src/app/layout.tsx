import './globals.css'
import React from 'react'
import type { Metadata } from 'next'
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
  openGraph: {
    title: 'Motus',
    description: 'A momentum-based platformer where precision and movement are everything.',
    url: siteUrl,
    type: 'website',
    siteName: 'Motus',
    images: [
      {
        url: '/Motus.png',
        alt: 'Motus',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Motus',
    description: 'A momentum-based platformer where precision and movement are everything.',
    images: ['/Motus.png'],
  },
  icons: {
    icon: '/favicon.svg',
  },
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
