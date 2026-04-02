import './globals.css'
import React from 'react'

export const metadata = {
  title: 'Survive the Field',
  description: 'Fast-paced physics survival game',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  )
}
