// LAST-VECTOR headless-Chrome check harness — steps 1..6.
// Boots Vite, opens the game at desktop + mobile viewports, drives the menu,
// player, every weapon, aliens, waves, damage, game over, pause and mobile
// controls through the __LV debug hook + DOM, measures fps, screenshots.
//
//   npm run check                       # all scenarios
//   npm run check -- --only=mobile
//   npm run check -- --biome=ember
//   npm run check -- --url=http://localhost:5173   (reuse a running server)

import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'out');
mkdirSync(OUT, { recursive: true });

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = 'true'] = a.replace(/^--/, '').split('=');
    return [k, v];
  }),
);
const SEED = args.seed ?? 'check-42';
const BIOME = args.biome ?? 'verdant';

const SCENARIOS = [
  { name: 'desktop-1080p', viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
  { name: 'desktop-1440p', viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 },
  { name: 'laptop-1600', viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 },
  { name: 'laptop-1366', viewport: { width: 1366, height: 768 }, deviceScaleFactor: 2 },
  { name: 'mobile-iphone', device: 'iPhone 13 landscape' },
  { name: 'mobile-android', device: 'Pixel 7 landscape' },
];

async function startGameServer() {
  const port = 2599;
  const proc = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: join(here, '../../server'),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = [];
  proc.stdout.on('data', (d) => log.push(String(d)));
  proc.stderr.on('data', (d) => log.push(String(d)));
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('game server did not start: ' + log.join(''))), 30000);
    const iv = setInterval(() => {
      if (log.join('').includes('listening')) {
        clearTimeout(t);
        clearInterval(iv);
        res();
      }
    }, 100);
  });
  return { url: `ws://localhost:${port}`, port, kill: () => proc.kill(), log };
}

async function runMultiplayer(browser, baseUrl, wsUrl) {
  const checks = [];
  const check = (name, ok, info = '') => checks.push({ name, ok: !!ok, info: String(info) });
  const errors = [];
  const mk = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`${name}: ${m.text()}`);
    });
    await page.goto(`${baseUrl}/?seed=${encodeURIComponent(SEED)}&biome=${BIOME}&server=${encodeURIComponent(wsUrl)}`, { waitUntil: 'load' });
    await page.waitForFunction(() => globalThis.__LV?.ready === true, null, { timeout: 30000 });
    await page.waitForTimeout(600);
    return { ctx, page, name };
  };
  const A = await mk('A');
  const B = await mk('B');
  const stats = (p) => p.page.evaluate(() => globalThis.__LV.stats());
  const setInput = (p, o) => p.page.evaluate((o) => globalThis.__LV.setInput(o), o);
  const idle = { moveX: 0, jet: false, fire: false, bomb: false, weapon: 0, bombType: 0, aimAngle: 0 };

  await A.page.click('[data-action=play-online]');
  await A.page.waitForFunction(() => globalThis.__LV.stats().phase === 'playing', null, { timeout: 15000 });
  const sA0 = await stats(A);
  check('A joins an online room', sA0.mode === 'net' && sA0.net?.connected, `mode=${sA0.mode}`);
  await B.page.click('[data-action=play-online]');
  await B.page.waitForFunction(() => globalThis.__LV.stats().phase === 'playing', null, { timeout: 15000 });
  await A.page.waitForFunction(() => globalThis.__LV.stats().players === 2, null, { timeout: 8000 }).catch(() => {});
  await B.page.waitForTimeout(700);
  const sA1 = await stats(A);
  const sB1 = await stats(B);
  check('both see 2 players in one room', sA1.players === 2 && sB1.players === 2, `A=${sA1.players} B=${sB1.players}`);
  check('same seed on both clients', sA1.seed === sB1.seed && sA1.seed === sA1.net?.tick * 0 + sA1.seed, `A=${sA1.seed} B=${sB1.seed}`);
  check('both landed on the spawn floor', sA1.player?.grounded && sB1.player?.grounded, JSON.stringify({ a: sA1.player?.grounded, b: sB1.player?.grounded }));
  check('HUD shows ONLINE', (await A.page.locator('[data-hud=online]').innerText()).includes('ONLINE'));

  // A moves right; B must see A move
  const bSeesA0 = sB1.others.find((o) => o.id === sA1.net.localId);
  await setInput(A, { ...idle, moveX: 1 });
  await A.page.waitForTimeout(1200);
  await setInput(A, { ...idle });
  await B.page.waitForTimeout(400);
  const sB2 = await stats(B);
  const bSeesA1 = sB2.others.find((o) => o.id === sA1.net.localId);
  check('B sees A move', bSeesA0 && bSeesA1 && bSeesA1.x > bSeesA0.x + 1, `A.x on B: ${bSeesA0?.x?.toFixed(2)} -> ${bSeesA1?.x?.toFixed(2)}`);
  const sA2 = await stats(A);
  check('A position matches on both clients', Math.abs(sA2.player.x - bSeesA1.x) < 1.0, `A=${sA2.player.x.toFixed(2)} onB=${bSeesA1?.x?.toFixed(2)}`);

  // A fires the beam into the floor; B must see the same tiles disappear
  const tB0 = sB2.tilesDestroyed;
  await setInput(A, { ...idle, weapon: 1, fire: true, aimAngle: Math.PI * 0.4 });
  await A.page.waitForTimeout(1000);
  await A.page.screenshot({ path: join(OUT, `mp-A-${BIOME}.png`) });
  // background tabs get rAF-throttled in headless Chrome: foreground B and let it catch up before shooting it
  await B.page.bringToFront();
  await B.page.waitForTimeout(400);
  await B.page.screenshot({ path: join(OUT, `mp-B-${BIOME}.png`) });
  // headless Chrome may hand back a stale composited frame for a tab that was in the background,
  // so also read the canvas straight from the renderer.
  const dataUrl = await B.page.evaluate(() => globalThis.__LV.capture());
  writeFileSync(join(OUT, `mp-B-${BIOME}-canvas.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
  const sBmid = await stats(B);
  const aOnB = sBmid.others.find((o) => o.id === sA1.net.localId);
  check('B renders A (remote player present in snapshot)', !!aOnB, JSON.stringify(aOnB));
  await setInput(A, { ...idle, weapon: 1 });
  await B.page.waitForTimeout(500);
  const sA3 = await stats(A);
  const sB3 = await stats(B);
  check('A carves via the server', sA3.tilesDestroyed > 0, `A destroyed=${sA3.tilesDestroyed}`);
  check('B receives the same tile deltas', sB3.tilesDestroyed > tB0 && sB3.tilesDestroyed === sA3.tilesDestroyed, `A=${sA3.tilesDestroyed} B=${sB3.tilesDestroyed}`);
  check('both grids agree', sA3.solidTiles === sB3.solidTiles, `A solid=${sA3.solidTiles} B solid=${sB3.solidTiles}`);

  // fps while online
  const fpsA = await A.page.evaluate(() => globalThis.__LV.fps);
  check('online client holds 55+ fps', fpsA >= 55, `fps=${fpsA.toFixed(0)}`);

  // ================= Step 9: prediction under 200 ms simulated latency
  await A.page.evaluate(() => globalThis.__LV.setLag(200));
  await A.page.waitForTimeout(600);
  const pA0 = (await stats(A)).player;
  await setInput(A, { ...idle, moveX: -1 });
  await A.page.waitForTimeout(120); // less than one round trip
  const pA1 = (await stats(A)).player;
  check('local player responds before the server round-trip (prediction)', pA1.x < pA0.x - 0.25, `dx=${(pA1.x - pA0.x).toFixed(2)} in 120ms @200ms lag`);
  await A.page.waitForTimeout(900);
  await setInput(A, { ...idle });
  await A.page.waitForTimeout(900);
  const sA5 = await stats(A);
  const bView = (await stats(B)).others.find((o) => o.id === sA1.net.localId);
  check('prediction converges with the server (avg err < 25 cm)', sA5.net.predErrAvg < 0.25, `avg=${(sA5.net.predErrAvg * 100).toFixed(1)} cm last=${(sA5.net.predErr * 100).toFixed(1)} cm`);
  check('A local position matches what B sees after settling', bView && Math.abs(bView.x - sA5.player.x) < 0.6, `A=${sA5.player.x.toFixed(2)} onB=${bView?.x?.toFixed(2)}`);
  check('server patches ~20 Hz', sA5.net.patchHz > 15 && sA5.net.patchHz < 26, `${sA5.net.patchHz.toFixed(1)} Hz`);

  // remote smoothness: sample B's view of A every 50 ms while A walks; no jumps > 0.6 tiles
  await setInput(A, { ...idle, moveX: 1 });
  const xs = [];
  for (let i = 0; i < 20; i++) {
    const o = (await stats(B)).others.find((o) => o.id === sA1.net.localId);
    if (o) xs.push(o.x);
    await B.page.waitForTimeout(50);
  }
  await setInput(A, { ...idle });
  let maxStep = 0;
  let backwards = 0;
  for (let i = 1; i < xs.length; i++) {
    const d = xs[i] - xs[i - 1];
    maxStep = Math.max(maxStep, Math.abs(d));
    if (d < -0.05) backwards++;
  }
  check('remote player interpolates smoothly (no jumps > 0.9 tiles, no rubber-banding)', xs.length > 10 && maxStep < 0.9 && backwards === 0, `samples=${xs.length} maxStep=${maxStep.toFixed(2)} backwards=${backwards}`);
  await A.page.keyboard.press('F3');
  await A.page.waitForTimeout(400);
  check('F3 shows the debug overlay', await A.page.locator('[data-ui=debug]').isVisible());
  const ping = (await stats(A)).net.pingMs;
  check('ping meter reflects the simulated 200 ms', ping > 170 && ping < 450, `ping=${ping.toFixed(0)} ms`);
  await A.page.screenshot({ path: join(OUT, `mp-A-${BIOME}-debug.png`) });
  await A.page.evaluate(() => globalThis.__LV.setLag(0));

  // B leaves; A sees 1 player
  await B.page.evaluate(() => globalThis.__LV.toMenu());
  await A.page.waitForFunction(() => globalThis.__LV.stats().players === 1, null, { timeout: 8000 }).catch(() => {});
  const sA4 = await stats(A);
  check('A sees B leave', sA4.players === 1, `players=${sA4.players}`);

  await A.ctx.close();
  await B.ctx.close();
  return { scenario: 'multiplayer', checks, errors, fpsA };
}

async function startServer() {
  if (args.url) return { url: args.url, kill() {} };
  const port = 5199;
  const proc = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: join(here, '../../client'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('vite did not start')), 30000);
    proc.stdout.on('data', (d) => {
      if (String(d).includes('Local:')) {
        clearTimeout(t);
        res();
      }
    });
    proc.stderr.on('data', (d) => process.stderr.write(d));
  });
  return { url: `http://localhost:${port}`, kill: () => proc.kill() };
}

async function runScenario(browser, sc, baseUrl) {
  const ctxOpts = sc.device ? { ...devices[sc.device] } : { viewport: sc.viewport, deviceScaleFactor: sc.deviceScaleFactor };
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  const warnings = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    else if (m.type() === 'warning') warnings.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  const isMobile = !!sc.device;
  const shot = (n) => page.screenshot({ path: join(OUT, `${sc.name}-${BIOME}-${n}.png`) });
  const stats = () => page.evaluate(() => globalThis.__LV.stats());
  const setInput = (o) => page.evaluate((o) => globalThis.__LV.setInput(o), o);
  const lv = (expr, arg) => page.evaluate(expr, arg);
  const checks = [];
  const check = (name, ok, info = '') => checks.push({ name, ok: !!ok, info: String(info) });
  const sampleFps = async (ms) => {
    const samples = [];
    const end = Date.now() + ms;
    while (Date.now() < end) {
      samples.push(await page.evaluate(() => globalThis.__LV.fps));
      await page.waitForTimeout(250);
    }
    const valid = samples.filter((s) => s > 0);
    return {
      avg: valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0,
      min: valid.length ? Math.min(...valid) : 0,
    };
  };
  const fpsLog = {};
  const visible = (sel) => page.locator(sel).first().isVisible().catch(() => false);
  const idle = { moveX: 0, jet: false, fire: false, bomb: false, bombType: 0 };

  const url = `${baseUrl}/?seed=${encodeURIComponent(SEED)}&biome=${BIOME}`;
  const tStart = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => globalThis.__LV?.ready === true, null, { timeout: 30000 });
  const loadMs = Date.now() - tStart;
  await page.waitForTimeout(1500);

  // ================= Step 6: main menu
  check('menu visible on load', await visible('[data-ui=start]'));
  // fullscreen / PWA plumbing
  const manifest = await page.request.get(`${baseUrl}/manifest.webmanifest`);
  check('web app manifest is served', manifest.ok() && (await manifest.text()).includes('"display": "fullscreen"'), `status=${manifest.status()}`);
  const icon = await page.request.get(`${baseUrl}/icons/icon-192.png`);
  check('home-screen icon is served', icon.ok(), `status=${icon.status()}`);
  const fsSupported = await page.evaluate(() => !!document.fullscreenEnabled);
  const fsBtn = await visible('[data-action=fullscreen]');
  check('fullscreen button shown when the browser supports it', fsBtn === fsSupported, `supported=${fsSupported} button=${fsBtn}`);
  const isIphone = /iPhone/.test(await page.evaluate(() => navigator.userAgent));
  check('iPhone gets the Add-to-Home-Screen hint (others do not)', (await visible('[data-ui=ios-hint]')) === isIphone, `iphone=${isIphone}`);
  const vh = await page.evaluate(() => ({ root: document.getElementById('root').getBoundingClientRect().height, inner: window.innerHeight }));
  check('game root fills the visible viewport', Math.abs(vh.root - vh.inner) < 2, JSON.stringify(vh));
  check('HUD hidden in menu', !(await visible('[data-ui=hud]')));
  fpsLog.menu = await sampleFps(1200);
  await shot('1-menu');
  // settings toggles persist in the store
  await page.click('[data-action=toggle-mute]');
  const muted = await page.evaluate(() => JSON.parse(localStorage.getItem('lv.settings') ?? '{}').muted);
  check('mute toggle persists', muted === true, `muted=${muted}`);
  await page.click('[data-action=toggle-mute]');
  await page.click(`[data-biome=${BIOME}]`);
  await page.click('[data-action=play]');
  await page.waitForFunction(() => globalThis.__LV.stats().phase === 'playing', null, { timeout: 5000 });
  check('play button starts a run', true);
  await lv(() => globalThis.__LV.setWaves(false)); // deterministic weapon tests; re-enabled for the wave test
  await page.waitForTimeout(900);
  check('HUD visible in game', await visible('[data-ui=hud]'));
  check('menu hidden in game', !(await visible('[data-ui=start]')));
  if (isMobile) check('mobile controls visible on touch device', await visible('[data-ui=mobile-controls]'));
  else check('mobile controls hidden on desktop', !(await visible('[data-ui=mobile-controls]')));

  // ================= Steps 1/3: spawn, jet, walk, fuel
  const s0 = await stats();
  check('player grounded after spawn', s0.player.grounded, `y=${s0.player.y.toFixed(2)}`);
  check('fuel full at rest', s0.player.fuel >= 99, `fuel=${s0.player.fuel.toFixed(0)}`);
  fpsLog.idle = await sampleFps(1200);
  await shot('2-hud');
  await setInput({ ...idle, jet: true, aimAngle: -Math.PI / 2 });
  await page.waitForTimeout(900);
  const s1 = await stats();
  check('jetpack lifts player', s1.player.y < s0.player.y - 1.5, `dy=${(s1.player.y - s0.player.y).toFixed(2)}`);
  check('jetpack burns fuel', s1.player.fuel < s0.player.fuel - 15, `fuel ${s0.player.fuel.toFixed(0)} -> ${s1.player.fuel.toFixed(0)}`);
  await setInput({ ...idle, moveX: 1, aimAngle: 0 });
  await page.waitForTimeout(1500);
  const s2 = await stats();
  check('walks right', s2.player.x > s1.player.x + 1, `dx=${(s2.player.x - s1.player.x).toFixed(2)}`);
  check('lands again', s2.player.grounded, `vel.y=${s2.player.vel.y.toFixed(2)}`);
  check('fuel regenerates on ground', s2.player.fuel > s1.player.fuel + 5, `fuel ${s1.player.fuel.toFixed(0)} -> ${s2.player.fuel.toFixed(0)}`);

  // ================= Step 4 + weapons roster (9 weapons, 2 slots, given via debug like a supply drop)
  await lv(() => globalThis.__LV.setDrops(false));
  const WEAPONS = ['blaster', 'vector', 'scatter', 'vulcan', 'plasma', 'flamer', 'arc', 'rail', 'launcher'];
  const DIGS = { flamer: false, plasma: false };
  for (const w of WEAPONS) {
    await lv(() => globalThis.__LV.resetHeat());
    const slot = await lv((w) => globalThis.__LV.giveWeapon(w), w);
    await setInput({ ...idle, weapon: slot, aimAngle: Math.PI * 0.3 });
    await page.waitForTimeout(150);
    const before = await stats();
    check(`weapon ${w} in slot ${slot}`, before.weapon.id === w, `got ${before.weapon.id} slots=${JSON.stringify(before.weapon.slots)}`);
    await setInput({ ...idle, weapon: slot, fire: true, aimAngle: Math.PI * 0.3 });
    await page.waitForTimeout(w === 'launcher' || w === 'rail' ? 900 : 650);
    if (['vector', 'scatter', 'arc', 'launcher', 'flamer', 'rail'].includes(w)) await shot(`3-weapon-${w}`);
    fpsLog[`w-${w}`] = await sampleFps(500);
    const after = await stats();
    if (DIGS[w] !== false) check(`weapon ${w} carves rock`, after.tilesDestroyed > before.tilesDestroyed, `+${after.tilesDestroyed - before.tilesDestroyed} tiles`);
    check(`weapon ${w} builds heat`, after.weapon.heat > 3, `heat=${after.weapon.heat.toFixed(0)}`);
    await setInput({ ...idle, weapon: slot, aimAngle: Math.PI * 0.3 });
    await page.waitForTimeout(150);
  }
  // slot swap: 1 and 2 hold different weapons; switching changes the active weapon
  const sw0 = await stats();
  await setInput({ ...idle, weapon: 0, aimAngle: 0 });
  await page.waitForTimeout(120);
  const sw1 = await stats();
  check('slot 1 / slot 2 swap works', sw0.weapon.id !== sw1.weapon.id && sw1.weapon.id === sw1.weapon.slots[0], `${sw0.weapon.id} -> ${sw1.weapon.id}`);
  // overheat + cooldown on the beam
  await lv(() => globalThis.__LV.resetHeat());
  const vslot = await lv(() => globalThis.__LV.giveWeapon('vector'));
  await setInput({ ...idle, weapon: vslot, fire: true, aimAngle: Math.PI * 0.35 });
  await page.waitForTimeout(2900);
  const so = await stats();
  check('beam overheats and cuts out', so.weapon.overheated && !so.weapon.beamFiring, `heat=${so.weapon.heat.toFixed(0)} over=${so.weapon.overheated}`);
  await setInput({ ...idle, weapon: vslot, aimAngle: 0 });
  await page.waitForTimeout(700);
  const sc2 = await stats();
  check('heat cools when released', sc2.weapon.heat < so.weapon.heat - 10, `heat ${so.weapon.heat.toFixed(0)} -> ${sc2.weapon.heat.toFixed(0)}`);
  // gel bomb (edge-triggered) — thrown toward the aim (left, into a pocket we clear first) with a lob
  await lv(() => {
    const p = globalThis.__LV.stats().player;
    globalThis.__LV.carve(p.x - 3, p.y - 1.5, 2.6);
  });
  await page.waitForTimeout(100);
  const bombsBefore = (await stats()).player.bombs;
  await setInput({ ...idle, weapon: 0, bomb: true, aimAngle: Math.PI - 0.35 });
  await page.waitForTimeout(150);
  const sb = await stats();
  check('held bomb button throws exactly one', sb.player.bombs === bombsBefore - 1 && sb.bombsLive === 1, `bombs ${bombsBefore} -> ${sb.player.bombs}, live=${sb.bombsLive}`);
  check('bomb flies toward the aim (left)', sb.bombs?.[0] && sb.bombs[0].x < sb.player.x - 0.6, `bomb.x=${sb.bombs?.[0]?.x?.toFixed(2)} player.x=${sb.player.x.toFixed(2)}`);
  await setInput({ ...idle, weapon: 0, aimAngle: Math.PI - 0.35 });
  await page.waitForTimeout(1250);
  await shot('4-bomb');
  await page.waitForTimeout(400);
  const sb2 = await stats();
  check('bomb exploded and carved', sb2.bombsLive === 0 && sb2.tilesDestroyed > sb.tilesDestroyed + 8, `+${sb2.tilesDestroyed - sb.tilesDestroyed}`);
  // mine + smoke: switch type (B), throw, spawn an alien next to it -> boom; smoke leaves a cloud
  await setInput({ ...idle, weapon: 0, bomb: true, bombType: 1, aimAngle: -0.4 });
  await page.waitForTimeout(120);
  await setInput({ ...idle, weapon: 0, bombType: 1, aimAngle: -0.4 });
  await page.waitForTimeout(1800);
  const sm = await stats();
  check('mine lands, sticks and arms', sm.bombs?.[0]?.type === 'mine' && sm.bombs[0].armed, JSON.stringify(sm.bombs?.[0]));
  if (sm.bombs?.[0]) {
    await lv((b) => globalThis.__LV.spawnAlienAt('crawler', b.x + 0.5, b.y - 0.6, true), sm.bombs[0]);
    await page.waitForTimeout(300);
    const sm2 = await stats();
    check('mine detonates on proximity', sm2.bombsLive === 0, `live=${sm2.bombsLive}`);
  }
  // smoke: drop it at our feet; it arms, then the owner standing next to it sets it off after the grace period
  await setInput({ ...idle, weapon: 0, bomb: true, bombType: 2, aimAngle: Math.PI / 2 - 0.15 });
  await page.waitForTimeout(120);
  await setInput({ ...idle, weapon: 0, bombType: 2, aimAngle: Math.PI / 2 - 0.15 });
  await page.waitForFunction(() => globalThis.__LV.stats().clouds > 0, null, { timeout: 6000 }).catch(() => {});
  const ss = await stats();
  check('smoke bomb leaves a cloud', ss.clouds > 0, `clouds=${ss.clouds} bombs=${JSON.stringify(ss.bombs)}`);
  await shot('4b-smoke');
  // regrow: carve a hole into rock away from the player, it heals within ~5 s
  await page.waitForTimeout(600);
  const rg0 = await stats();
  await lv(() => {
    const p = globalThis.__LV.stats().player;
    globalThis.__LV.carve(p.x + 4, p.y + 3.5, 2);
  });
  const rg1 = await stats();
  check('regrow test: carve made a hole', rg1.solidTiles < rg0.solidTiles, `${rg0.solidTiles} -> ${rg1.solidTiles}`);
  await page.waitForTimeout(5200);
  const rg2 = await stats();
  check('carved rock regrows after ~4 s', rg2.solidTiles > rg1.solidTiles, `${rg1.solidTiles} -> ${rg2.solidTiles} (start ${rg0.solidTiles})`);
  check('regrown rock is rendered (tile sprites == solid tiles)', rg2.sprites === rg2.solidTiles, `sprites=${rg2.sprites} solid=${rg2.solidTiles}`);
  await shot('4d-regrown');
  // supply drop: spawn a crate above the player; it descends and gets picked up
  const dp0 = await stats();
  await lv(() => globalThis.__LV.spawnDrop('rail'));
  await page.waitForTimeout(200);
  const dp1 = await stats();
  check('supply crate spawns above the player', dp1.drops === dp0.drops + 1, `drops=${dp1.drops}`);
  await shot('4c-crate');
  await page.waitForTimeout(9000);
  const dp2 = await stats();
  check('crate lands and is picked up into a slot', dp2.drops === dp0.drops && dp2.weapon.slots.includes('rail'), `slots=${JSON.stringify(dp2.weapon.slots)} drops=${dp2.drops}`);

  // ================= Step 5: aliens, kills, drops, waves
  await lv(() => globalThis.__LV.resetHeat());
  // clear a pocket to the right so the target is in open air regardless of where the walk ended
  await lv(() => {
    const p = globalThis.__LV.stats().player;
    globalThis.__LV.carve(p.x + 1.5, p.y - 1.2, 1.4); // corridor from the muzzle...
    globalThis.__LV.carve(p.x + 3.5, p.y - 1.5, 1.8); // ...to the target pocket, clear of the feet
  });
  await page.waitForTimeout(200);
  const sPre = await stats();
  await lv(() => globalThis.__LV.spawnAlien('flyer', 3.5, -1.2, true));
  const sa = await stats();
  check('alien spawns', sa.aliens === sPre.aliens + 1, `aliens ${sPre.aliens} -> ${sa.aliens}`);
  await lv(() => globalThis.__LV.giveWeapon('vulcan'));
  const aim = await lv(() => globalThis.__LV.aimAtAlien());
  await setInput({ ...idle, weapon: (await stats()).weapon.active, fire: true, aimAngle: aim }); // vulcan at the frozen flyer
  await page.waitForTimeout(1500);
  await setInput({ ...idle, weapon: 0, aimAngle: 0 });
  const sk = await stats();
  check('weapons kill aliens (kills++)', sk.kills > sPre.kills, `kills ${sPre.kills} -> ${sk.kills}`);
  check('score increases', sk.score > sPre.score, `score ${sPre.score} -> ${sk.score}`);
  // wave director
  await lv(() => globalThis.__LV.setWaves(true));
  await lv(() => globalThis.__LV.startWaveNow());
  await page.waitForTimeout(1600);
  const sw = await stats();
  check('wave starts and spawns aliens', sw.wave >= 1 && sw.waveState === 'active' && sw.aliens > 0, `wave=${sw.wave} state=${sw.waveState} aliens=${sw.aliens}`);
  // a crowd near the player for the screenshot + fps under load
  await lv(() => {
    const p = globalThis.__LV.stats().player;
    globalThis.__LV.carve(p.x + 1.5, p.y - 1.2, 1.4);
    globalThis.__LV.carve(p.x + 5, p.y - 2.5, 3.2);
  });
  for (let i = 0; i < 5; i++) await lv((i) => globalThis.__LV.spawnAlien('crawler', 3.5 + i * 0.8, -1.5 - (i % 2), true), i);
  for (let i = 0; i < 3; i++) await lv((i) => globalThis.__LV.spawnAlien('flyer', 5 + i * 0.7, -3.5 + i * 0.5, true), i);
  await lv(() => globalThis.__LV.resetHeat());
  const arcSlot = await lv(() => globalThis.__LV.giveWeapon('arc'));
  const aimCrowd = await lv(() => globalThis.__LV.aimAtNearestAlien());
  await setInput({ ...idle, weapon: arcSlot, fire: true, aimAngle: aimCrowd }); // arc into the crowd
  await page.waitForTimeout(500);
  await shot('5-aliens-arc');
  fpsLog.crowd = await sampleFps(1500);
  await setInput({ ...idle, weapon: arcSlot, aimAngle: 0 });
  const scr = await stats();
  check('arc chains kills in a crowd', scr.kills > sk.kills, `kills ${sk.kills} -> ${scr.kills}`);
  check('shards / pickups appear from digging or drops', scr.shards > 0 || scr.pickups > 0, `shards=${scr.shards} pickups=${scr.pickups}`);
  const phaseNow = (await stats()).phase;
  check('run still alive after crowd test', phaseNow === 'playing', `phase=${phaseNow}`);
  if (phaseNow === 'playing') check('HUD shows wave', (await page.locator('[data-hud=wave]').innerText()).includes('WAVE'));
  else {
    await page.click('[data-action=retry]');
    await page.waitForFunction(() => globalThis.__LV.stats().phase === 'playing', null, { timeout: 5000 });
  }

  // ================= Step 5/6: damage, pause, game over, retry
  const hp = await lv(() => globalThis.__LV.damagePlayer(30));
  check('player takes damage', hp <= 70, `health=${hp}`);
  await page.waitForTimeout(150);
  const hpText = await page.locator('[data-hud=health] .hud-seg.on').count();
  check('health bar reflects damage', hpText <= 7, `segments=${hpText}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check('Escape pauses', (await stats()).phase === 'paused' && (await visible('[data-ui=pause]')));
  await shot('6-pause');
  await page.click('[data-action=resume]');
  await page.waitForTimeout(150);
  check('resume works', (await stats()).phase === 'playing');
  await lv(() => globalThis.__LV.damagePlayer(999));
  await page.waitForTimeout(400);
  check('lethal damage -> game over', (await stats()).phase === 'gameover' && (await visible('[data-ui=gameover]')));
  await shot('7-gameover');
  await page.click('[data-action=retry]');
  await page.waitForFunction(() => globalThis.__LV.stats().phase === 'playing', null, { timeout: 5000 });
  await page.waitForTimeout(300);
  const sr = await stats();
  check('retry resets run', sr.player.health === 100 && sr.tilesDestroyed === 0 && sr.aliens === 0 && sr.kills === 0, JSON.stringify({ hp: sr.player.health, tiles: sr.tilesDestroyed, aliens: sr.aliens }));

  // ================= Step 6: mobile virtual sticks drive the sim
  if (isMobile) {
    await setInput(null);
    // both sticks are always visible at rest (low opacity) and brighten while touched
    const rest = await page.evaluate(() => ['[data-ui=stick-move]', '[data-ui=stick-aim]'].map((q) => {
      const el = document.querySelector(q);
      const r = el.getBoundingClientRect();
      return { op: +getComputedStyle(el).opacity, visible: r.width > 40 && r.top > 0 && r.left > 0 && r.right < innerWidth && r.bottom < innerHeight };
    }));
    check('twin sticks visible at rest with low opacity', rest.every((r) => r.visible && r.op > 0.2 && r.op < 0.6), JSON.stringify(rest));
    const zone = await page.locator('.zone.left').boundingBox();
    await page.mouse.move(zone.x + zone.width * 0.5, zone.y + zone.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(zone.x + zone.width * 0.5 + 30, zone.y + zone.height * 0.6 - 40, { steps: 4 });
    await page.waitForTimeout(250);
    const active = await page.evaluate(() => +getComputedStyle(document.querySelector('[data-ui=stick-move]')).opacity);
    const mv = (await stats()).player;
    await page.screenshot({ path: join(OUT, `${sc.name}-${BIOME}-8b-stick-touched.png`) });
    await page.mouse.up();
    await page.waitForTimeout(150);
    check('touched stick brightens and drives movement/jet', active > 0.65 && (mv.thrusting || mv.vel.x > 0.5), `opacity=${active} thrusting=${mv.thrusting} vx=${mv.vel.x.toFixed(2)}`);
    const p0 = await stats();
    await lv(() => globalThis.__LV.setTouch({ moveX: 1, jet: true, fire: false, aimAngle: 0, bomb: false, swap: false, pause: false }));
    await page.waitForTimeout(700);
    const p1 = await stats();
    check('touch stick moves + jets', p1.player.x > p0.player.x + 0.5 && p1.player.y < p0.player.y - 0.5, `dx=${(p1.player.x - p0.player.x).toFixed(2)} dy=${(p1.player.y - p0.player.y).toFixed(2)}`);
    await lv(() => globalThis.__LV.setTouch({ moveX: 0, jet: false, fire: true, aimAngle: 1.2, bomb: false, swap: false, pause: false }));
    await page.waitForTimeout(700);
    const p2 = await stats();
    check('touch aim-stick fires', p2.tilesDestroyed > p1.tilesDestroyed, `+${p2.tilesDestroyed - p1.tilesDestroyed}`);
    await shot('8-mobile-controls');
    await lv(() => globalThis.__LV.setTouch(null));
  }
  await setInput(null);
  await lv(() => globalThis.__LV.toMenu());
  await page.waitForTimeout(200);
  check('menu button returns to menu', (await stats()).phase === 'menu');

  // world rebuild stress: menu <-> play several times must not corrupt the renderer
  for (let i = 0; i < 4; i++) {
    await lv(() => globalThis.__LV.start());
    await page.waitForTimeout(250);
    await lv(() => globalThis.__LV.toMenu());
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(300);
  const statsAfter = await stats();
  check('render loop never threw (incl. 4 world rebuilds)', statsAfter.loopErrors === 0, `loopErrors=${statsAfter.loopErrors}`);
  const gpu = await page.evaluate(() => globalThis.__LV.gpu());
  await ctx.close();
  return { scenario: sc.name, loadMs, gpu, fpsLog, checks, statsAfter, errors, warnings };
}

const server = await startServer();
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});

const only = args.only;
const results = [];
try {
  for (const sc of SCENARIOS) {
    if (only && !sc.name.includes(only)) continue;
    process.stdout.write(`▶ ${sc.name} ... `);
    try {
      const r = await runScenario(browser, sc, server.url);
      results.push(r);
      const failed = r.checks.filter((c) => !c.ok);
      const minFps = Math.min(...Object.values(r.fpsLog).map((f) => f.min));
      console.log(`fps min ${minFps.toFixed(0)} (menu ${r.fpsLog.menu.avg.toFixed(0)}, crowd ${r.fpsLog.crowd.avg.toFixed(0)}) | checks ${r.checks.length - failed.length}/${r.checks.length} | errors ${r.errors.length}`);
      for (const c of failed) console.log(`   ✗ ${c.name} — ${c.info}`);
      for (const e of r.errors) console.log(`   ! ${e}`);
    } catch (e) {
      results.push({ scenario: sc.name, fatal: String(e), checks: [], errors: [] });
      console.log(`FAILED: ${e.message}`);
    }
  }
  if (!only || 'multiplayer'.includes(only)) {
    process.stdout.write(`▶ multiplayer (2 tabs) ... `);
    let gs = null;
    try {
      gs = await startGameServer();
      const r = await runMultiplayer(browser, server.url, gs.url);
      results.push(r);
      const failed = r.checks.filter((c) => !c.ok);
      console.log(`checks ${r.checks.length - failed.length}/${r.checks.length} | errors ${r.errors.length}`);
      for (const c of failed) console.log(`   ✗ ${c.name} — ${c.info}`);
      for (const e of r.errors) console.log(`   ! ${e}`);
    } catch (e) {
      results.push({ scenario: 'multiplayer', fatal: String(e), checks: [], errors: [] });
      console.log(`FAILED: ${e.message}`);
      if (gs) console.log(gs.log.slice(-10).join(''));
    } finally {
      gs?.kill();
    }
  }
} finally {
  await browser.close();
  server.kill();
}

writeFileSync(join(OUT, 'report.json'), JSON.stringify(results, null, 2));
let md = `| scenario | canvas | fps menu | fps idle | fps beam | fps vulcan | fps flamer | fps crowd | min fps | checks | errors |\n|---|---|---|---|---|---|---|---|---|---|---|\n`;
for (const r of results) {
  if (r.fatal) {
    md += `| ${r.scenario} | FATAL | | | | | | | | | ${r.fatal} |\n`;
    continue;
  }
  if (!r.fpsLog) {
    const passed = r.checks.filter((c) => c.ok).length;
    md += `| ${r.scenario} | 2 tabs | | | | | | | ${r.fpsA?.toFixed(0) ?? '-'} | ${passed}/${r.checks.length} | ${r.errors.length} |\n`;
    continue;
  }
  const f = r.fpsLog;
  const s = r.statsAfter;
  const minFps = Math.min(...Object.values(f).map((x) => x.min));
  const passed = r.checks.filter((c) => c.ok).length;
  const a = (x) => (x ? x.avg.toFixed(0) : '-');
  md += `| ${r.scenario} | ${s.vw}×${s.vh}@${s.scale}x | ${a(f.menu)} | ${a(f.idle)} | ${a(f['w-vector'])} | ${a(f['w-vulcan'])} | ${a(f['w-flamer'])} | ${a(f.crowd)} | ${minFps.toFixed(0)} | ${passed}/${r.checks.length} | ${r.errors.length} |\n`;
}
md += `\nGPU: ${results.find((r) => r.gpu)?.gpu ?? 'n/a'}\n`;
for (const r of results) {
  if (r.errors?.length) md += `\n**${r.scenario} errors**\n` + r.errors.map((e) => `- ${e}`).join('\n') + '\n';
  const failed = (r.checks ?? []).filter((c) => !c.ok);
  if (failed.length) md += `\n**${r.scenario} failed checks**\n` + failed.map((c) => `- ${c.name}: ${c.info}`).join('\n') + '\n';
}
writeFileSync(join(OUT, 'report.md'), md);
console.log('\n' + md);
