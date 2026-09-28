// Frame-pacing probe: flies the pilot and zooms the scope out while tracing every rendered
// frame, then reports long frames, repeated frames (the picture did not move although the
// camera was moving) and jumps (the picture moved much more than usual in one frame).
//
//   node tools/check/probe-smooth.mjs [--cpu=4] [--url=http://localhost:5173] [--device=android|desktop]
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const CPU = Number(args.cpu ?? 4);
const DEVICE = args.device ?? 'android';

async function startVite() {
  const port = 5198;
  const proc = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: join(here, '../../client'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  proc.stdout.on('data', (d) => (out += d));
  proc.stderr.on('data', (d) => (out += d));
  for (let i = 0; i < 150 && !/Local:/.test(out); i++) await new Promise((r) => setTimeout(r, 100));
  return { url: `http://localhost:${port}`, kill: () => proc.kill() };
}

/**
 * Summarise a trace. A "hitch" is a frame whose on-screen position is more than 1 px off the
 * midpoint of the frames either side (second difference): even motion, including slow motion
 * and normal 1-px rounding, never trips it; a repeated-then-doubled frame always does.
 */
export function analyse(frames, label) {
  const dts = [];
  for (let i = 1; i < frames.length; i++) dts.push(frames[i].t - frames[i - 1].t);
  const sorted = [...dts].sort((x, y) => x - y);
  const med = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const hitch = (kx, ky) => {
    let n = 0;
    for (let i = 1; i + 1 < frames.length; i++) {
      // the straight line between the neighbours *in time* (frames can land late)
      const k = (frames[i].t - frames[i - 1].t) / Math.max(1e-6, frames[i + 1].t - frames[i - 1].t);
      const ex = frames[i][kx] - (frames[i - 1][kx] + (frames[i + 1][kx] - frames[i - 1][kx]) * k);
      const ey = frames[i][ky] - (frames[i - 1][ky] + (frames[i + 1][ky] - frames[i - 1][ky]) * k);
      if (Math.max(Math.abs(ex), Math.abs(ey)) > 1.01) n++;
    }
    return n;
  };
  const r = {
    label,
    frames: frames.length,
    frameMs: { median: +med.toFixed(1), p95: +p95.toFixed(1), max: +Math.max(...dts).toFixed(1) },
    longFrames: dts.filter((d) => d > med * 1.7).length,
    renderMs: (() => {
      const m = frames.map((f) => f.ms).sort((x, y) => x - y);
      return {
        median: +(m[Math.floor(m.length / 2)] ?? 0).toFixed(2),
        p95: +(m[Math.floor(m.length * 0.95)] ?? 0).toFixed(2),
      };
    })(),
    worldHitches: hitch('wx', 'wy'),
    pilotHitches: hitch('px', 'py'),
  };
  console.log(JSON.stringify(r));
  if (process.env.TRACE_OUT)
    writeFileSync(join(process.env.TRACE_OUT, `trace-${label}.json`), JSON.stringify(frames));
  return r;
}

const vite = args.url ? { url: args.url, kill: () => {} } : await startVite();
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'],
});
const ctx = await browser.newContext(
  DEVICE === 'desktop'
    ? { viewport: { width: 1600, height: 900 } }
    : { ...devices['Pixel 7 landscape'] },
);
const page = await ctx.newPage();
// --hz=120: drive the game's frames from a 120 Hz timer instead of the (60 Hz) display, like a fast phone screen
if (args.hz) {
  await page.addInitScript((hz) => {
    const period = 1000 / hz;
    let next = performance.now();
    window.requestAnimationFrame = (cb) => {
      next += period;
      const wait = Math.max(0, next - performance.now());
      return setTimeout(() => cb(performance.now()), wait);
    };
    window.cancelAnimationFrame = (id) => clearTimeout(id);
  }, Number(args.hz));
}
page.on('pageerror', (e) => console.log('pageerror', e.message));
const cdp = await ctx.newCDPSession(page);
await page.goto(`${vite.url}/?seed=check-42&map=${args.map ?? 'hollow'}`, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__LV?.ready === true, null, { timeout: 30000 });
await page.click('[data-action=play]');
await page.waitForFunction(() => globalThis.__LV.stats().phase === 'playing', null, {
  timeout: 15000,
});
await page.evaluate(() => {
  globalThis.__LV.setWaves(false);
  globalThis.__LV.setDrops(false);
});
await page.waitForTimeout(1500);
if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
if (args.interp === 'off') await page.evaluate(() => globalThis.__LV.setInterp(false));
// the headless display presents at 60 Hz and blocks faster GPU frames: at --hz, trace what *would* be drawn
if (args.hz) await page.evaluate(() => globalThis.__LV.setPresent(false));
const setInput = (o) => page.evaluate((o) => globalThis.__LV.setInput(o), o);
const idle = {
  moveX: 0,
  jet: false,
  fire: false,
  bomb: false,
  weapon: 0,
  bombType: 0,
  aimAngle: 0,
};
const results = [];

// 1. fly: walk right with the jetpack on
await page.evaluate(() => globalThis.__LV.traceStart());
await setInput({ ...idle, moveX: 1, jet: true });
await page.waitForTimeout(1200);
await setInput({ ...idle, moveX: -1, jet: false });
await page.waitForTimeout(1000);
await setInput({ ...idle });
results.push(analyse(await page.evaluate(() => globalThis.__LV.traceStop()), 'fly'));

// 2. the sniper's 7x scope: the widest view (the whole cave on screen)
await page.evaluate(() => globalThis.__LV.teleportSpawn());
await page.waitForTimeout(600);
const slot = await page.evaluate(() => globalThis.__LV.giveWeapon('sniper'));
await setInput({ ...idle, weapon: slot });
await page.waitForTimeout(300);
await page.evaluate(() => globalThis.__LV.traceStart());
await page.evaluate(() => globalThis.__LV.setScope(true));
await page.waitForTimeout(1500);
results.push(analyse(await page.evaluate(() => globalThis.__LV.traceStop()), 'zoom-blend'));
await page.evaluate(() => globalThis.__LV.traceStart());
await setInput({ ...idle, weapon: slot, moveX: 1, jet: true });
await page.waitForTimeout(1200);
await setInput({ ...idle, weapon: slot, moveX: -1 });
await page.waitForTimeout(1000);
await setInput({ ...idle, weapon: slot });
results.push(analyse(await page.evaluate(() => globalThis.__LV.traceStop()), 'fly-zoomed-out'));
const s = await page.evaluate(() => globalThis.__LV.stats());
console.log(
  JSON.stringify({ sprites: s.sprites, visibleChunks: s.visibleChunks, zoom: s.zoom ?? null }),
);
await page.screenshot({ path: join(here, 'out', 'probe-smooth-zoomed.png') });

await browser.close();
vite.kill();
