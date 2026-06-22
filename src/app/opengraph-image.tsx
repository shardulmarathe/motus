import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export const alt = 'Motus — a momentum-based platformer'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const TAGLINE = 'A momentum-based platformer where precision and movement are everything.'

// Fixed particle positions (landing-page dot field)
const DOTS: { x: number; y: number; o: number }[] = [
  { x: 80, y: 90, o: 0.22 },
  { x: 220, y: 140, o: 0.18 },
  { x: 380, y: 70, o: 0.25 },
  { x: 540, y: 120, o: 0.15 },
  { x: 700, y: 55, o: 0.2 },
  { x: 920, y: 100, o: 0.17 },
  { x: 1080, y: 160, o: 0.23 },
  { x: 150, y: 480, o: 0.19 },
  { x: 320, y: 520, o: 0.16 },
  { x: 500, y: 560, o: 0.21 },
  { x: 760, y: 500, o: 0.18 },
  { x: 980, y: 540, o: 0.24 },
  { x: 1100, y: 420, o: 0.14 },
  { x: 60, y: 300, o: 0.2 },
  { x: 1140, y: 280, o: 0.17 },
]

async function loadNunito(weight: 700 | 800) {
  const url =
    weight === 800
      ? 'https://fonts.gstatic.com/s/nunito/v26/XRXV3I6Li01BKofiO5NChlJlbliCeQ.woff'
      : 'https://fonts.gstatic.com/s/nunito/v26/XRXI3I6Li01BKofiOc5wtlZ2di4HclQgZXo.woff'
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to load Nunito ${weight}`)
  return res.arrayBuffer()
}

export default async function Image() {
  const [nunitoBold, nunitoExtraBold] = await Promise.all([
    loadNunito(700),
    loadNunito(800),
  ])

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 80px',
          background: 'radial-gradient(circle at 50% 40%, rgba(24, 52, 96, 0.45) 0%, rgba(4, 10, 28, 1) 72%)',
          backgroundColor: '#030816',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Ambient dots */}
        {DOTS.map((dot, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: dot.x,
              top: dot.y,
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: `rgba(90, 130, 175, ${dot.o})`,
            }}
          />
        ))}

        {/* Text block */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
            maxWidth: 640,
            zIndex: 1,
          }}
        >
          <div
            style={{
              fontSize: 108,
              fontFamily: 'NunitoExtraBold',
              fontWeight: 800,
              color: '#06b6d4',
              letterSpacing: '0.04em',
              lineHeight: 1,
              textShadow: '0 0 40px rgba(6, 182, 212, 0.75), 0 0 80px rgba(6, 182, 212, 0.35)',
            }}
          >
            Motus
          </div>
          <div
            style={{
              fontSize: 28,
              fontFamily: 'NunitoBold',
              fontWeight: 700,
              color: '#cbd5e1',
              lineHeight: 1.45,
              letterSpacing: '0.02em',
            }}
          >
            {TAGLINE}
          </div>
        </div>

        {/* Player ball + goal orb (game artwork) */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            width: 340,
            height: 340,
            zIndex: 1,
          }}
        >
          {/* Green goal orb */}
          <div
            style={{
              position: 'absolute',
              top: 40,
              right: 20,
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: 'radial-gradient(circle at 35% 30%, #86efac 0%, #4ade80 45%, #22c55e 100%)',
              boxShadow: '0 0 28px rgba(34, 197, 94, 0.55)',
            }}
          />
          {/* Player puck glow */}
          <div
            style={{
              position: 'absolute',
              width: 200,
              height: 200,
              borderRadius: '50%',
              background: 'rgba(6, 182, 212, 0.22)',
              boxShadow: '0 0 60px rgba(6, 182, 212, 0.5)',
            }}
          />
          {/* Player puck (matches favicon / in-game ball) */}
          <div
            style={{
              width: 140,
              height: 140,
              borderRadius: '50%',
              background: 'radial-gradient(circle at 38% 32%, #9be8ff 0%, #67e8f9 35%, #06b6d4 70%, #01606f 100%)',
              boxShadow: '0 0 40px rgba(6, 182, 212, 0.65)',
            }}
          />
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'NunitoBold', data: nunitoBold, weight: 700, style: 'normal' },
        { name: 'NunitoExtraBold', data: nunitoExtraBold, weight: 800, style: 'normal' },
      ],
    }
  )
}
