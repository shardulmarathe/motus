import './globals.css'
import React from 'react'
import type { Metadata, Viewport } from 'next'
import { Analytics } from '@vercel/analytics/react'

const siteUrl = 'https://playmotus.vercel.app'

// Platforms (iMessage, Discord, Slack, …) cache og:image per-URL. Versioning
// the URL with the deploy's commit SHA makes every deploy a fresh URL, so new
// shares always fetch the latest screenshot instead of a stale cached one.
const ogImage = `/og-home.png?v=${(process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev').slice(0, 8)}`

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Motus',
  description: 'A momentum-based platformer where precision and movement are everything.',
  alternates: {
    canonical: siteUrl,
  },
  // og:image is a screenshot of the homepage, regenerated after every push by
  // .github/workflows/og-refresh.yml -> public/og-home.png (committed by CI;
  // headless Chrome can't run in Vercel's build container).
  openGraph: {
    title: 'Motus',
    description: 'A momentum-based platformer where precision and movement are everything.',
    url: siteUrl,
    type: 'website',
    siteName: 'Motus',
    images: [{ url: ogImage, width: 1200, height: 630, alt: 'Motus' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Motus',
    description: 'A momentum-based platformer where precision and movement are everything.',
    images: [ogImage],
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
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
