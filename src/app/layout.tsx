import './globals.css'
import React from 'react'
import { Analytics } from '@vercel/analytics/react'
import { Nunito } from 'next/font/google'

const nunito = Nunito({
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
  variable: '--font-nunito',
})

export const metadata = {
  title: 'Motus',
  description: 'Fast-paced physics survival game',
  icons: {
    icon: '/favicon.svg',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={nunito.variable}>
      <body className={nunito.className}>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
