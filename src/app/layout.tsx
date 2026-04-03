import './globals.css'
import React from 'react'
import { Analytics } from '@vercel/analytics/react'

export const metadata = {
  title: 'Motus',
  description: 'Fast-paced physics survival game',
  icons: {
    icon: '/favicon.svg',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
