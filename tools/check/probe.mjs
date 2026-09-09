// Probe a running server exactly like a real device would (no test params).
//   node tools/check/probe.mjs http://192.168.1.59:5173 [chromium|webkit]
import { chromium, webkit, devices } from 'playwright';
import { writeFileSync } from 'node:fs';
const url = process.argv[2] ?? 'http://localhost:5173';
const engine = process.argv[3] ?? 'chromium';
const browserType = engine === 'webkit' ? webkit : chromium;
const browser = await browserType.launch({ headless: true, args: engine === 'chromium' ? ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] : [] });
const scenarios = [
  { name: 'desktop-1600', opts: { viewport: { width: 1600, height: 900 } } },
  { name: 'desktop-1366', opts: { viewport: { width: 1366, height: 768 } } },
  { name: 'iphone', opts: { ...devices['iPhone 13 landscape'] } },
  { name: 'android', opts: { ...devices['Pixel 7 landscape'] } },
];
for (const sc of scenarios) {
  const ctx = await browser.newContext(sc.opts);
  const page = await ctx.newPage();
  const log = [];
  page.on('console', (m) => log.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => log.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
  page.on('requestfailed', (r) => log.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
  const t0 = Date.now();
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    const ready = await page.waitForFunction(() => globalThis.__LV?.ready === true, null, { timeout: 15000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(1500);
    const menu = await page.locator('[data-ui=start]').isVisible().catch(() => false);
    const canvas = await page.evaluate(() => { const c = document.querySelector('canvas'); return c ? { w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight } : null; });
    await page.screenshot({ path: `tools/check/out/probe-${engine}-${sc.name}-menu.png` });
    let stats = null;
    if (menu) {
      await page.click('[data-action=play]');
      await page.waitForTimeout(2500);
      stats = await page.evaluate(() => { const s = globalThis.__LV?.stats?.(); return s ? { phase: s.phase, fps: +globalThis.__LV.fps.toFixed(0), player: s.player && { x: +s.player.x.toFixed(1), y: +s.player.y.toFixed(1), grounded: s.player.grounded }, frames: s.frames, loopErrors: s.loopErrors } : null; });
      await page.screenshot({ path: `tools/check/out/probe-${engine}-${sc.name}-play.png` });
    }
    console.log(`\n=== ${engine} / ${sc.name}  (${Date.now() - t0} ms)`);
    console.log('ready:', ready, '| menu visible:', menu, '| canvas:', JSON.stringify(canvas));
    console.log('after PLAY:', JSON.stringify(stats));
  } catch (e) {
    console.log(`\n=== ${engine} / ${sc.name} FAILED: ${e.message}`);
  }
  const important = log.filter((l) => !l.startsWith('[log]') && !l.startsWith('[info]') && !l.startsWith('[debug]'));
  console.log('console (errors/warnings):', important.length ? '\n  ' + important.slice(0, 12).join('\n  ') : 'none');
  writeFileSync(`tools/check/out/probe-${engine}-${sc.name}.log`, log.join('\n'));
  await ctx.close();
}
await browser.close();
