import { chromium, webkit, devices } from 'playwright';
const url = process.argv[2];
const engine = process.argv[3] ?? 'chromium';
const browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true, args: engine === 'chromium' ? ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal'] : [] });
const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
const page = await ctx.newPage();
// headless can't resize a fullscreen window: stub the API so PLAY doesn't enter fullscreen
await page.addInitScript(() => { Element.prototype.requestFullscreen = () => Promise.reject(new Error('stubbed')); });
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => globalThis.__LV?.ready === true);
await page.click('[data-action=play]');
await page.waitForTimeout(800);
const show = async (label) => { const r = await page.evaluate(() => globalThis.__LV.stats().render); console.log(label.padEnd(28), JSON.stringify(r)); };
await show('initial 844x390');
// simulate the address bar hiding (taller visible viewport), then fullscreen-ish, then rotate back
for (const [w, h, label] of [[844, 430, 'bar hidden 844x430'], [926, 428, 'fullscreen 926x428'], [844, 390, 'back 844x390']]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(400);
  await show(label);
}
await page.screenshot({ path: `tools/check/out/probe-resize-${engine}.png` });
const dataUrl = await page.evaluate(() => globalThis.__LV.capture());
const { writeFileSync } = await import('node:fs');
writeFileSync(`tools/check/out/probe-resize-${engine}-canvas.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));
await browser.close();
