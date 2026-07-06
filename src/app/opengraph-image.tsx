import { ImageResponse } from 'next/og'

// Coded OpenGraph card — rendered from the values below, never a screenshot,
// so it stays in sync with the live game with zero manual updates.
export const alt = 'Motus — a momentum-based platformer where precision and movement are everything'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const TITLE = 'MOTUS'
const TAGLINE = 'A momentum-based platformer where precision and movement are everything.'

// Full glyph set so Google's font subsetting includes every character we render.
const GLYPHS =
  ' ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,:;!?/&()@·—–'

// satori only supports ttf/otf/woff (not woff2); requesting without a browser
// UA makes Google serve truetype. Falls back to the built-in font on failure.
async function loadFont(family: string, weight: number, text: string): Promise<ArrayBuffer | null> {
  try {
    const url = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@${weight}&text=${encodeURIComponent(text)}`
    const css = await (await fetch(url)).text()
    const src = css.match(/src:\s*url\(([^)]+)\)\s*format\('(?:opentype|truetype)'\)/)
    if (!src) return null
    const res = await fetch(src[1])
    if (!res.ok) return null
    return await res.arrayBuffer()
  } catch {
    return null
  }
}

export default async function Image() {
  const [sora, soraBody] = await Promise.all([
    loadFont('Sora', 800, GLYPHS),
    loadFont('Sora', 600, GLYPHS),
  ])

  const fonts = [
    ...(sora ? [{ name: 'Sora', data: sora, weight: 800 as const, style: 'normal' as const }] : []),
    ...(soraBody ? [{ name: 'SoraBody', data: soraBody, weight: 600 as const, style: 'normal' as const }] : []),
  ]

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '76px 84px',
          background: 'linear-gradient(140deg, #0c1220 0%, #05070f 60%, #060814 100%)',
          position: 'relative',
        }}
      >
        {/* neon glows */}
        <div
          style={{
            position: 'absolute', top: -180, left: -120, width: 640, height: 640, borderRadius: 9999,
            background: 'radial-gradient(closest-side, rgba(45,226,230,0.30), rgba(45,226,230,0))', display: 'flex',
          }}
        />
        <div
          style={{
            position: 'absolute', bottom: -220, right: -140, width: 620, height: 620, borderRadius: 9999,
            background: 'radial-gradient(closest-side, rgba(176,107,255,0.28), rgba(176,107,255,0))', display: 'flex',
          }}
        />
        {/* motion streak */}
        <div
          style={{
            position: 'absolute', left: 0, top: 372, width: '100%', height: 6,
            background: 'linear-gradient(90deg, rgba(45,226,230,0) 0%, #2de2e6 45%, #ff4d6d 100%)',
            display: 'flex', opacity: 0.85,
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ width: 18, height: 18, borderRadius: 9999, background: '#2de2e6', boxShadow: '0 0 24px #2de2e6', display: 'flex' }} />
          <div style={{ fontFamily: 'SoraBody', fontSize: 24, letterSpacing: 8, color: '#9fb0c8', display: 'flex' }}>
            ARCADE PLATFORMER
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 30 }}>
          <div
            style={{
              fontFamily: 'Sora', fontSize: 210, lineHeight: 0.9, letterSpacing: 4, display: 'flex',
              color: '#e6eef8',
              textShadow: '0 0 40px rgba(45,226,230,0.55), 0 0 90px rgba(176,107,255,0.35)',
            }}
          >
            {TITLE}
          </div>
          <div style={{ fontFamily: 'SoraBody', fontSize: 36, color: '#9fb0c8', maxWidth: 940, lineHeight: 1.3, display: 'flex' }}>
            {TAGLINE}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontFamily: 'SoraBody', fontSize: 24, color: '#2de2e6', display: 'flex' }}>playmotus.vercel.app</div>
          <div style={{ fontFamily: 'SoraBody', fontSize: 24, color: '#ff4d6d', display: 'flex' }}>hold to build momentum</div>
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined },
  )
}
