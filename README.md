# Motus

Simple Next.js + TypeScript HTML5 Canvas game MVP.

Run:

```bash
npm install
npm run dev
```

Controls:
- Arrow keys or WASD: move the puck
- Space: restart after game over

Project structure:

- `src/app` - Next.js App Router pages and layout
- `src/components/GameCanvas.tsx` - canvas and game loop
- `src/lib/physics.ts` - vector and collision helpers
- `src/lib/gameLogic.ts` - spawn/reset helpers
