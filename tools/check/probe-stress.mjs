import { chromium } from 'playwright';
const url = process.argv[2];
const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] });
let worst = 0;
for (let run = 0; run < 5; run++) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => globalThis.__LV?.ready === true);
  await page.waitForTimeout(600);
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => globalThis.__LV.start());
    await page.waitForTimeout(350);
    await page.evaluate(() => globalThis.__LV.toMenu());
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => globalThis.__LV.start());
  await page.waitForTimeout(800);
  const s = await page.evaluate(() => { const s = globalThis.__LV.stats(); return { frames: s.frames, loopErrors: s.loopErrors, fps: +globalThis.__LV.fps.toFixed(0), phase: s.phase }; });
  worst = Math.max(worst, s.loopErrors);
  console.log(`run ${run + 1}: 6 rebuild cycles -> frames=${s.frames} loopErrors=${s.loopErrors} fps=${s.fps} pageErrors=${errs.length}`);
  await ctx.close();
}
console.log(worst === 0 ? 'STRESS OK' : `STRESS FAILED worst loopErrors=${worst}`);
await browser.close();
