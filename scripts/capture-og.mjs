// Build-time OpenGraph capture: screenshots the LIVE homepage and writes it to
// public/og-home.png, so the link preview always shows the current site with no
// manual work. Runs before `next build` (see package.json) against a local
// `next dev` server. Resilient: on any failure it warns and exits 0 (never
// blocks the deploy) — the last committed public/og-home.png stays as fallback.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "public", "og-home.png");

const PORT = Number(process.env.OG_PORT || 4319);
const URL = `http://localhost:${PORT}/`;
const SETTLE_MS = Number(process.env.OG_SETTLE_MS || 3000); // 2D canvas title screen — settle for neon bg

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(url, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok || res.status === 404) return true;
    } catch {
      /* not up yet */
    }
    await sleep(1000);
  }
  return false;
}

async function main() {
  const nextBin = join(ROOT, "node_modules", ".bin", "next");
  if (!existsSync(nextBin)) {
    console.warn("[og] next binary not found — skipping capture");
    return;
  }

  // Detached so we can kill the whole process group (next dev spawns workers).
  const server = spawn(nextBin, ["dev", "-p", String(PORT)], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  });

  const killServer = () => {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  };

  try {
    const up = await waitForServer(URL);
    if (!up) {
      console.warn("[og] dev server did not become ready — skipping capture");
      return;
    }

    const { default: puppeteer } = await import("puppeteer");
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-webgl",
        "--ignore-gpu-blocklist",
        "--hide-scrollbars",
        "--force-color-profile=srgb",
      ],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 2 });
      await page.emulateMediaFeatures([
        { name: "prefers-reduced-motion", value: "no-preference" },
      ]);
      await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
      await sleep(SETTLE_MS);
      await page.screenshot({ path: OUT, type: "png" });
      console.log(`[og] captured homepage -> ${OUT}`);
    } finally {
      await browser.close();
    }
  } catch (err) {
    console.warn(`[og] capture failed (${err?.message}); keeping existing og-home.png`);
  } finally {
    killServer();
  }
}

await main();
// Never fail the build on capture problems.
process.exit(0);
