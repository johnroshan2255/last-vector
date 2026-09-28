// LAST-VECTOR headless-Chrome check harness — steps 1..6.
// Boots Vite, opens the game at desktop + mobile viewports, drives the menu,
// player, every weapon, aliens, waves, damage, game over, pause and mobile
// controls through the __LV debug hook + DOM, measures fps, screenshots.
//
//   npm run check                       # all scenarios
//   npm run check -- --only=mobile
//   npm run check -- --map=furnace       (hollow | furnace | rift | glacier)
//   npm run check -- --url=http://localhost:5173   (reuse a running server)

import { chromium, devices } from 'playwright';
import { Client as ColyseusClient } from 'colyseus.js';
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
const BIOME = args.map ?? args.biome ?? 'hollow'; // map id (kept under the old name for the file names below)

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
      // the deliberate wrong-code lookup answers 404, which Chrome logs as a resource error
      if (m.type() === 'error' && !/404 \(Not Found\)/.test(m.text())) errors.push(`${name}: ${m.text()}`);
    });
    // nowaves: the host's room has no aliens, so the PvP / prediction checks are deterministic
    await page.goto(`${baseUrl}/?seed=${encodeURIComponent(SEED)}&map=${BIOME}&server=${encodeURIComponent(wsUrl)}&nowaves`, { waitUntil: 'load' });
    await page.waitForFunction(() => globalThis.__LV?.ready === true, null, { timeout: 30000 });
    await page.waitForTimeout(600);
    return { ctx, page, name };
  };
  const A = await mk('A');
  const B = await mk('B');
  const stats = (p) => p.page.evaluate(() => globalThis.__LV.stats());
  const setInput = (p, o) => p.page.evaluate((o) => globalThis.__LV.setInput(o), o);
  const phaseIs = (p, ph, timeout = 15000) => p.page.waitForFunction((ph) => globalThis.__LV.stats().phase === ph, ph, { timeout }).then(() => true, () => false);
  const idle = { moveX: 0, jet: false, fire: false, bomb: false, weapon: 0, bombType: 0, aimAngle: 0 };

  // ================= host / join with a room code
  // A picks a callsign (settings → general) so the kill feed / death screen can name it
  await A.page.click('[data-action=settings]');
  await A.page.fill('[data-ui=callsign]', 'ALPHA');
  await A.page.click('[data-action=settings-close]');
  await A.page.click('[data-action=host]');
  check('HOST GAME opens a lobby', await phaseIs(A, 'lobby'));
  const sA0 = await stats(A);
  const code = sA0.net?.code ?? '';
  check('room code is 5 chars', /^[A-Z0-9]{5}$/.test(code), `code=${code}`);
  check('lobby shows the code', (await A.page.locator('[data-ui=room-code]').innerText()).trim() === code, await A.page.locator('[data-ui=room-code]').innerText());
  check('host sees START MATCH; match not started yet', (await A.page.locator('[data-action=start-match]').isVisible()) && sA0.net.isHost && !sA0.net.started, JSON.stringify({ isHost: sA0.net.isHost, started: sA0.net.started }));
  check('room capacity is 12', sA0.net.maxPlayers === 12, `max=${sA0.net.maxPlayers}`);
  await A.page.screenshot({ path: join(OUT, `mp-lobby-host-${BIOME}.png`) });

  // B: wrong code is refused with a readable error, then the right one joins the lobby
  await B.page.click('[data-action=join]');
  await B.page.fill('[data-ui=code-input]', 'ZZZZZ');
  await B.page.click('[data-action=join-submit]');
  await B.page.waitForSelector('[data-ui=net-error]', { timeout: 10000 }).catch(() => {});
  const errText = (await B.page.locator('[data-ui=net-error]').innerText().catch(() => '')).trim();
  check('wrong code → ROOM NOT FOUND, back on the menu', /NOT FOUND/.test(errText) && (await stats(B)).phase === 'menu', `err="${errText}"`);
  await B.page.fill('[data-ui=code-input]', code);
  await B.page.press('[data-ui=code-input]', 'Enter');
  check('JOIN WITH CODE lands in the same lobby', await phaseIs(B, 'lobby'));
  await A.page.waitForFunction(() => globalThis.__LV.stats().net.roster.length === 2, null, { timeout: 8000 }).catch(() => {});
  const sA1 = await stats(A);
  const sB1 = await stats(B);
  check('both see 2 pilots in the roster', sA1.net.roster.length === 2 && sB1.net.roster.length === 2, `A=${sA1.net.roster.length} B=${sB1.net.roster.length}`);
  check('same room code on both', sB1.net.code === code, `B=${sB1.net.code}`);
  check('guest waits for the host', (await B.page.locator('[data-ui=waiting]').isVisible()) && !sB1.net.isHost && !sB1.net.started);
  check('roster names the host as ALPHA', sB1.net.roster.some((r) => r.host && r.name === 'ALPHA'), JSON.stringify(sB1.net.roster.map((r) => [r.name, r.host])));
  check('no waves while in the lobby', sA1.wave === 0 && sA1.aliens === 0, `wave=${sA1.wave} aliens=${sA1.aliens}`);
  await B.page.screenshot({ path: join(OUT, `mp-lobby-guest-${BIOME}.png`) });

  await A.page.click('[data-action=start-match]');
  check('host START → host playing', await phaseIs(A, 'playing', 8000));
  check('host START → guest playing', await phaseIs(B, 'playing', 8000));
  await A.page.waitForFunction(() => globalThis.__LV.stats().players === 2, null, { timeout: 8000 }).catch(() => {});
  await B.page.waitForTimeout(700);
  const sA2 = await stats(A);
  const sB2 = await stats(B);
  check('A joined an online room', sA2.mode === 'net' && sA2.net?.connected, `mode=${sA2.mode}`);
  check('both see 2 players in one room', sA2.players === 2 && sB2.players === 2, `A=${sA2.players} B=${sB2.players}`);
  check('same seed on both clients', sA2.seed === sB2.seed, `A=${sA2.seed} B=${sB2.seed}`);
  check('both landed on the spawn floor', sA2.player?.grounded && sB2.player?.grounded, JSON.stringify({ a: sA2.player?.grounded, b: sB2.player?.grounded }));
  const onlineText = await A.page.locator('[data-hud=online]').innerText();
  check('HUD shows ONLINE + room code + 2/12', onlineText.includes('ONLINE') && onlineText.includes(code) && onlineText.includes('2/12'), onlineText);
  check('in-game settings cog visible', await A.page.locator('[data-action=settings-cog]').isVisible());
  const tag = (await stats(A)).indicators.find((i) => i.kind === 'player' && i.id === sB2.net.localId);
  check('name tag over the other pilot when in view', !!tag && tag.onScreen && tag.label === 'PILOT-' + sB2.net.localId.replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase(), JSON.stringify(tag));

  // ================= PvP: A shoots B (Mini-Militia style), B dies, gets the kill feed, respawns
  // both pilots are still on their spawn slots, 1.2 tiles apart on the flat pocket floor
  await setInput(B, { ...idle, aimAngle: Math.PI }); // B stands still
  const aimAtB = async () => {
    const s = await stats(A);
    const b = s.others.find((o) => o.id === sB2.net.localId);
    return b ? Math.atan2(b.y - s.player.y, b.x - s.player.x) : 0;
  };
  const hpB0 = (await stats(B)).player.health;
  let hurtAt = null;
  let deadAt = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 9000) {
    await setInput(A, { ...idle, weapon: 0, fire: true, aimAngle: await aimAtB() });
    await A.page.waitForTimeout(120);
    const sb = await stats(B);
    if (hurtAt === null && sb.player.health < hpB0) hurtAt = Date.now() - t0;
    if (!sb.player.alive) {
      deadAt = Date.now() - t0;
      break;
    }
  }
  await setInput(A, { ...idle, weapon: 0 });
  check('A\'s blaster hurts B (players can damage each other)', hurtAt !== null, `first hit after ${hurtAt} ms (hp ${hpB0} -> ${(await stats(B)).player.health})`);
  check('sustained fire kills B', deadAt !== null, `dead after ${deadAt} ms`);
  await B.page.waitForTimeout(300);
  const death = await B.page.evaluate(() => globalThis.__LV.death());
  check('B sees KILLED BY ALPHA + respawn countdown', death && death.by === 'ALPHA' && death.respawnIn > 0 && (await B.page.locator('[data-hud=death]').isVisible()), JSON.stringify(death));
  check('B stays in the match (no game over online)', (await stats(B)).phase === 'playing');
  const sAk = await stats(A);
  check('A is credited with the kill', sAk.kills >= 1, `kills=${sAk.kills}`);
  const feed = await A.page.locator('[data-hud=feed]').innerText().catch(() => '');
  check('kill feed shows the kill', /ALPHA/.test(feed) || /YOU/.test(feed), `feed="${feed}"`);
  {
    const a = (await stats(A)).sfx;
    const b = (await stats(B)).sfx;
    check('B hears their own death yell; A hears B\'s yell + the kill chime (Mini Militia style)', (b.death ?? 0) >= 1 && (a.deathOther ?? 0) >= 1 && (a.kill ?? 0) >= 1, JSON.stringify({ A: { deathOther: a.deathOther, kill: a.kill }, B: { death: b.death } }));
    check('B hears every hit land, and hears A\'s blaster (remote gunfire is audible)', (b.hurt ?? 0) >= 1 && (b.shot ?? 0) >= 1, JSON.stringify({ hurt: b.hurt, shot: b.shot }));
  }
  await B.page.screenshot({ path: join(OUT, `mp-B-${BIOME}-killed.png`) });
  await A.page.screenshot({ path: join(OUT, `mp-A-${BIOME}-kill.png`) });
  const respawned = await B.page.waitForFunction(() => globalThis.__LV.stats().player?.alive === true, null, { timeout: 7000 }).then(() => true, () => false);
  const sBr = await stats(B);
  check('B respawns with full health after ~3 s', respawned && sBr.player.health === 100 && sBr.player.grounded !== undefined, `alive=${sBr.player?.alive} hp=${sBr.player?.health}`);
  check('A hears B respawn', ((await stats(A)).sfx.respawn ?? 0) >= 1, JSON.stringify((await stats(A)).sfx.respawn));
  check('respawn overlay gone', (await B.page.evaluate(() => globalThis.__LV.death())) === null && !(await B.page.locator('[data-hud=death]').isVisible()));
  check('B\'s deaths counted in the roster', (await stats(A)).net.roster.find((r) => r.id === sB2.net.localId)?.deaths === 1, JSON.stringify((await stats(A)).net.roster));


  // A moves right; B must see A move
  const bSeesA0 = sB2.others.find((o) => o.id === sA2.net.localId);
  await setInput(A, { ...idle, moveX: 1 });
  await A.page.waitForTimeout(1200);
  await setInput(A, { ...idle });
  await B.page.waitForTimeout(400);
  const sB3 = await stats(B);
  const bSeesA1 = sB3.others.find((o) => o.id === sA2.net.localId);
  check('B sees A move', bSeesA0 && bSeesA1 && bSeesA1.x > bSeesA0.x + 1, `A.x on B: ${bSeesA0?.x?.toFixed(2)} -> ${bSeesA1?.x?.toFixed(2)}`);
  const sA3 = await stats(A);
  check('A position matches on both clients', Math.abs(sA3.player.x - bSeesA1.x) < 1.0, `A=${sA3.player.x.toFixed(2)} onB=${bSeesA1?.x?.toFixed(2)}`);

  // B flies up out of A's view: A gets an edge arrow with B's name and distance
  await setInput(B, { ...idle, jet: true, aimAngle: -Math.PI / 2 });
  await B.page.waitForTimeout(2600);
  await setInput(B, { ...idle, aimAngle: -Math.PI / 2 });
  const sArrow = await stats(A);
  const bArrow = sArrow.indicators.find((i) => i.kind === 'player' && i.id === sB2.net.localId);
  const bPos = sArrow.others.find((o) => o.id === sB2.net.localId);
  check('pilot out of view → edge arrow + name + distance', !!bArrow && !bArrow.onScreen && /PILOT-.* \d+m/.test(bArrow.label) && bArrow.y < sArrow.vh * 0.15, `${JSON.stringify(bArrow)} B.y=${bPos?.y?.toFixed(1)} A.y=${sArrow.player.y.toFixed(1)}`);
  await A.page.screenshot({ path: join(OUT, `mp-A-${BIOME}-arrow.png`) });
  await B.page.waitForTimeout(2500); // let B fall back
  // A fires the beam into the floor; B must see the same tiles disappear
  const tB0 = sB3.tilesDestroyed;
  await setInput(A, { ...idle, weapon: 1, fire: true, aimAngle: Math.PI * 0.4 });
  await A.page.waitForTimeout(1000);
  await A.page.screenshot({ path: join(OUT, `mp-A-${BIOME}.png`) });
  await B.page.bringToFront();
  await B.page.waitForTimeout(400);
  await B.page.screenshot({ path: join(OUT, `mp-B-${BIOME}.png`) });
  const dataUrl = await B.page.evaluate(() => globalThis.__LV.capture());
  writeFileSync(join(OUT, `mp-B-${BIOME}-canvas.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
  const sBmid = await stats(B);
  const aOnB = sBmid.others.find((o) => o.id === sA2.net.localId);
  check('B renders A (remote player present in snapshot)', !!aOnB, JSON.stringify(aOnB));
  await setInput(A, { ...idle, weapon: 1 });
  await B.page.waitForTimeout(500);
  const sA4 = await stats(A);
  const sB4 = await stats(B);
  check('A carves via the server', sA4.tilesDestroyed > 0, `A destroyed=${sA4.tilesDestroyed}`);
  check('B receives the same tile deltas', sB4.tilesDestroyed > tB0 && sB4.tilesDestroyed === sA4.tilesDestroyed, `A=${sA4.tilesDestroyed} B=${sB4.tilesDestroyed}`);
  check('both grids agree', sA4.solidTiles === sB4.solidTiles, `A solid=${sA4.solidTiles} B solid=${sB4.solidTiles}`);

  // pause online = overlay only, the match continues
  await A.page.click('[data-action=settings-cog]');
  await A.page.waitForTimeout(200);
  const pausedA = await stats(A);
  check('cog opens the in-game menu online (overlay, room code shown)', pausedA.phase === 'paused' && (await A.page.locator('[data-ui=pause-room]').innerText()).includes(code));
  await A.page.screenshot({ path: join(OUT, `mp-A-${BIOME}-pause.png`) });
  await A.page.click('[data-action=resume]');
  await A.page.waitForTimeout(150);
  check('resume online', (await stats(A)).phase === 'playing');

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
  const bView = (await stats(B)).others.find((o) => o.id === sA2.net.localId);
  check('prediction converges with the server (avg err < 25 cm)', sA5.net.predErrAvg < 0.25, `avg=${(sA5.net.predErrAvg * 100).toFixed(1)} cm last=${(sA5.net.predErr * 100).toFixed(1)} cm`);
  check('A local position matches what B sees after settling', bView && Math.abs(bView.x - sA5.player.x) < 0.6, `A=${sA5.player.x.toFixed(2)} onB=${bView?.x?.toFixed(2)}`);
  check('server patches ~20 Hz', sA5.net.patchHz > 15 && sA5.net.patchHz < 26, `${sA5.net.patchHz.toFixed(1)} Hz`);

  // weapon swap under 200 ms lag: one Q press = exactly one swap that sticks (no flip-flop from stale server frames)
  await setInput(A, null);
  await A.page.mouse.move(800, 450);
  const swapFrom = (await stats(A)).weapon.active;
  await A.page.keyboard.press('KeyQ');
  const seen = [];
  for (let i = 0; i < 14; i++) {
    await A.page.waitForTimeout(100);
    seen.push((await stats(A)).weapon.active);
  }
  const target = swapFrom ? 0 : 1;
  const flips = seen.reduce((n, v, i) => n + (i > 0 && v !== seen[i - 1] ? 1 : 0), 0);
  check('Q swaps the weapon once and it stays (lagged)', seen[0] === target && seen.every((v) => v === target) && flips === 0, `from=${swapFrom} seen=${seen.join('')}`);
  const bOnA0 = (await stats(A)).others.find((o) => o.id === sB2.net.localId);
  await setInput(B, null);
  await B.page.mouse.move(800, 450);
  const bFrom = (await stats(B)).weapon.active;
  await B.page.keyboard.press('KeyQ');
  const seenB = [];
  for (let i = 0; i < 10; i++) {
    await B.page.waitForTimeout(100);
    seenB.push((await stats(B)).weapon.active);
  }
  check('the other pilot can swap too, exactly once', seenB.every((v) => v === (bFrom ? 0 : 1)), `from=${bFrom} seen=${seenB.join('')} (${bOnA0 ? 'B visible on A' : 'B not on A'})`);
  // wheel: a trackpad flick (many small deltas) is one swap
  const wFrom = (await stats(A)).weapon.active;
  for (let i = 0; i < 12; i++) await A.page.mouse.wheel(0, 8);
  await A.page.waitForTimeout(500);
  const wAfter = (await stats(A)).weapon.active;
  check('a wheel flick with many tiny deltas swaps once', wAfter !== wFrom, `from=${wFrom} after=${wAfter}`);
  await A.page.keyboard.press('KeyQ'); // restore slot 0 for the tests below
  await A.page.waitForTimeout(300);
  await setInput(A, { ...idle });
  await setInput(B, { ...idle });

  // remote smoothness: sample B's view of A every 50 ms while A walks; no jumps > 0.9 tiles
  await setInput(A, { ...idle, moveX: 1 });
  const xs = [];
  for (let i = 0; i < 20; i++) {
    const o = (await stats(B)).others.find((o) => o.id === sA2.net.localId);
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

  // terrain materials stay in sync: both clients replay the server's tile ops (carving, cracks, falling sand)
  await A.page.waitForTimeout(500);
  {
    const a = await stats(A);
    const b = await stats(B);
    check('both pilots see the same cave (rock, hard stone, sand) after all the digging', a.solidTiles === b.solidTiles && a.hardTiles === b.hardTiles && a.sandTiles === b.sandTiles && a.hardTiles > 0 && a.sandTiles > 0, JSON.stringify({ A: [a.solidTiles, a.hardTiles, a.sandTiles], B: [b.solidTiles, b.hardTiles, b.sandTiles] }));
  }
  // guest B leaves: nothing happens to the host, B just vanishes from A's world
  await B.page.evaluate(() => globalThis.__LV.toMenu());
  await A.page.waitForFunction(() => globalThis.__LV.stats().players === 1, null, { timeout: 8000 }).catch(() => {});
  const sA6 = await stats(A);
  check('guest leaves → host keeps playing, sees 1 player', sA6.players === 1 && sA6.phase === 'playing', `players=${sA6.players} phase=${sA6.phase}`);
  // B rejoins the running room by code (mid-match join), then the host leaves → B is told and sent to the menu
  await B.page.click('[data-action=join]');
  await B.page.fill('[data-ui=code-input]', code);
  await B.page.press('[data-ui=code-input]', 'Enter');
  check('rejoining a started room by code goes straight into play', await phaseIs(B, 'playing', 10000));
  await A.page.evaluate(() => globalThis.__LV.toMenu());
  const bBack = await phaseIs(B, 'menu', 10000);
  const notice = (await B.page.locator('[data-ui=net-notice]').innerText().catch(() => '')).trim();
  check('host leaves → guest gets "host left" notice and lands on the main menu', bBack && /HOST LEFT/.test(notice), `phase=${(await stats(B)).phase} notice="${notice}"`);
  await B.page.screenshot({ path: join(OUT, `mp-B-${BIOME}-host-left.png`) });
  const gone = await fetch(`${wsUrl.replace(/^ws/, 'http')}/rooms/${code}`);
  check('closed room code no longer resolves (404)', gone.status === 404, `status=${gone.status}`);

  await A.ctx.close();
  await B.ctx.close();
  return { scenario: 'multiplayer', checks, errors, fpsA };
}

/** 12-player cap + host hand-off, with lightweight Node clients (no browser). */
async function runCapacity(wsUrl) {
  const checks = [];
  const check = (name, ok, info = '') => checks.push({ name, ok: !!ok, info: String(info) });
  const errors = [];
  const http = wsUrl.replace(/^ws/, 'http');
  const client = new ColyseusClient(wsUrl);
  const rooms = [];
  let log = null;
  try {
    log = (m) => args.verbose && process.stdout.write(`\n   · ${m}`);
    log('creating room');
    const host = await client.create('arena', { mode: 'host', map: BIOME, name: 'HOST' });
    rooms.push(host);
    log(`created ${host.roomId}`);
    const welcome = await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('no welcome')), 8000);
      host.onMessage('welcome', (m) => {
        clearTimeout(t);
        res(m);
      });
    });
    const code = welcome.code;
    check('node client hosts a room and gets a code', /^[A-Z0-9]{5}$/.test(code), `code=${code}`);
    const look = await (await fetch(`${http}/rooms/${code}`)).json();
    check('GET /rooms/:code resolves the room', look.roomId === host.roomId && look.maxClients === 12 && look.started === false, JSON.stringify(look));
    const bad = await fetch(`${http}/rooms/ZZZZZ`);
    check('GET /rooms/:code → 404 for unknown code', bad.status === 404, `status=${bad.status}`);
    for (let i = 1; i < 12; i++) {
      const g = await client.joinById(host.roomId, { name: `G${i}` });
      g.onMessage('welcome', () => {});
      rooms.push(g);
      log(`joined ${i + 1}`);
    }
    check('12 players fit in one room', rooms.length === 12 && rooms.every((r) => r.sessionId), `joined=${rooms.length}`);
    let refused = null;
    try {
      const extra = await client.joinById(host.roomId, { name: 'G12' });
      extra.onMessage('welcome', () => {});
      rooms.push(extra);
    } catch (e) {
      refused = String(e?.message ?? e);
    }
    check('13th player is refused', refused !== null, `err="${refused}"`);
    const full = await fetch(`${http}/rooms/${code}`);
    check('lookup reports the room as full (409)', full.status === 409, `status=${full.status}`);
    await new Promise((r) => setTimeout(r, 300));
    const second = rooms[1];
    const nameOk = second.state?.players?.get(second.sessionId)?.name === 'G1';
    check('callsigns are stored server-side', nameOk, `name=${second.state?.players?.get(second.sessionId)?.name}`);
    // a guest leaving changes nothing for the others
    await rooms[11].leave();
    await new Promise((r) => setTimeout(r, 400));
    check('guest leaves → room stays open with 11', second.state?.players?.size === 11, `players=${second.state?.players?.size}`);
    // the host leaving closes the room: every guest hears HostLeft and is disconnected
    let heard = 0;
    let dropped = 0;
    for (const g of rooms.slice(1, 11)) {
      g.onMessage('hostLeft', () => heard++);
      g.onLeave(() => dropped++);
    }
    log('host leaving');
    await host.leave();
    await new Promise((res) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (dropped >= 10 || Date.now() - t0 > 6000) {
          clearInterval(iv);
          res();
        }
      }, 100);
    });
    check('host leaves → every guest is told and disconnected', heard === 10 && dropped === 10, `heard=${heard} dropped=${dropped}`);
  } catch (e) {
    errors.push(String(e?.stack ?? e));
  } finally {
    log?.('cleanup');
    await Promise.all(rooms.map((r) => Promise.race([r.leave().catch(() => {}), new Promise((res) => setTimeout(res, 2000))])));
  }
  return { scenario: 'capacity', checks, errors };
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

  const url = `${baseUrl}/?seed=${encodeURIComponent(SEED)}&map=${BIOME}`;
  const tStart = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => globalThis.__LV?.ready === true, null, { timeout: 30000 });
  const loadMs = Date.now() - tStart;
  await page.waitForTimeout(1500);

  // ================= Step 6: main menu
  check('menu visible on load', await visible('[data-ui=start]'));
  await shot('1-menu');
  // fullscreen / PWA plumbing
  const manifest = await page.request.get(`${baseUrl}/manifest.webmanifest`);
  check('web app manifest is served', manifest.ok() && (await manifest.text()).includes('"display": "fullscreen"'), `status=${manifest.status()}`);
  const icon = await page.request.get(`${baseUrl}/icons/icon-192.png`);
  check('home-screen icon is served', icon.ok(), `status=${icon.status()}`);
  // uncluttered menu: no weapon/bomb lists or key hints on the title panel, a handful of buttons, a settings cog
  const menuButtons = await page.locator('[data-ui=start] .panel button').count();
  check('menu is lean (≤ 9 buttons, no arsenal on the title panel)', menuButtons <= 9 && (await page.locator('[data-ui=start] .arsenal').count()) === 0, `buttons=${menuButtons}`);
  check('settings cog on the menu', await visible('[data-action=settings] .cog'));
  check('no fullscreen button cluttering the menu', !(await visible('[data-ui=start] [data-action=fullscreen]')));
  await page.click('[data-action=settings]');
  await page.waitForTimeout(150);
  check('cog opens the settings modal', await visible('[data-ui=settings-modal]'));
  const fsSupported = await page.evaluate(() => !!document.fullscreenEnabled);
  const fsBtn = await visible('[data-action=fullscreen]');
  check('fullscreen toggle lives in settings when the browser supports it', fsBtn === fsSupported, `supported=${fsSupported} button=${fsBtn}`);
  check('callsign field in settings', await visible('[data-ui=callsign]'));
  await page.click('[data-tab=weapons]');
  check('settings → WEAPONS lists all 11 weapons', (await page.locator('[data-tab-body=weapons] .arsenal-item').count()) === 11, `items=${await page.locator('[data-tab-body=weapons] .arsenal-item').count()}`);
  check('weapon icons in the WEAPONS tab', (await page.locator('[data-tab-body=weapons] .arsenal-icon').count()) === 11, `icons=${await page.locator('[data-tab-body=weapons] .arsenal-icon').count()}`);
  {
    const unlocks = await page.locator('[data-tab-body=weapons] .arsenal-unlock').allInnerTexts();
    const maps = await page.locator('[data-tab-body=weapons] .arsenal-maps').allInnerTexts();
    check('every drop weapon is available in every wave and on every map', unlocks.filter((t) => /ALL WAVES/.test(t)).length === 9 && unlocks.filter((t) => /START KIT/.test(t)).length === 2 && maps.every((t) => /ALL MAPS/.test(t)), `${unlocks.join('|')} / ${maps.join('|')}`);
  }
  await shot('1b-settings-weapons');
  await page.click('[data-tab=bombs]');
  check('settings → BOMBS lists all 6 bombs with icons', (await page.locator('[data-tab-body=bombs] .arsenal-item').count()) === 6 && (await page.locator('[data-tab-body=bombs] .arsenal-icon').count()) === 6, `items=${await page.locator('[data-tab-body=bombs] .arsenal-item').count()}`);
  await shot('1d-settings-bombs');
  await page.click('[data-tab=controls]');
  check('settings → CONTROLS lists the keys', (await page.locator('[data-tab-body=controls] .key').count()) >= 6);
  await page.click('[data-tab=general]');
  const isIphone = /iPhone/.test(await page.evaluate(() => navigator.userAgent));
  check('iPhone gets the Add-to-Home-Screen hint (others do not)', (await visible('[data-ui=ios-hint]')) === isIphone, `iphone=${isIphone}`);
  const vh = await page.evaluate(() => ({ root: document.getElementById('root').getBoundingClientRect().height, inner: window.innerHeight }));
  check('game root fills the visible viewport', Math.abs(vh.root - vh.inner) < 2, JSON.stringify(vh));
  check('HUD hidden in menu', !(await visible('[data-ui=hud]')));
  fpsLog.menu = await sampleFps(1200);
  await shot('1c-settings-general');
  // settings toggles persist in the store
  await page.click('[data-action=toggle-mute]');
  const muted = await page.evaluate(() => JSON.parse(localStorage.getItem('lv.settings') ?? '{}').muted);
  check('mute toggle persists', muted === true, `muted=${muted}`);
  await page.click('[data-action=toggle-mute]');
  await page.click('[data-action=settings-close]');
  await page.waitForTimeout(100);
  check('settings modal closes', !(await visible('[data-ui=settings-modal]')));
  // join-with-code UI: 5-char code required
  await page.click('[data-action=join]');
  check('JOIN WITH CODE shows the code field', await visible('[data-ui=code-input]'));
  await page.fill('[data-ui=code-input]', 'ab1');
  check('short code keeps JOIN disabled', await page.locator('[data-action=join-submit]').isDisabled());
  await page.click('[data-action=join-cancel]');
  check('three map cards on the menu (1 sky, 2 cave)', (await page.locator('[data-ui=maps] .map-card').count()) === 3 && (await page.locator('[data-ui=maps] .map-swatch[data-backdrop=sky]').count()) === 1);
  await page.click(`[data-map=${BIOME}]`);
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

  // the Blastronaut sky + clouds stay put on screen while the camera moves (no drift, no parallax jitter)
  {
    const b0 = await stats();
    await setInput({ ...idle, moveX: 1, jet: true });
    await page.waitForTimeout(700);
    await setInput({ ...idle });
    await page.waitForTimeout(300);
    const b1 = await stats();
    const moved = b0.camera[0] !== b1.camera[0] || b0.camera[1] !== b1.camera[1];
    check('sky and clouds do not move while the camera does', moved && b0.backdrop.clouds.length === 3 && JSON.stringify(b0.backdrop) === JSON.stringify(b1.backdrop), `camera ${b0.camera} -> ${b1.camera} backdrop ${JSON.stringify(b0.backdrop)} -> ${JSON.stringify(b1.backdrop)}`);
    await lv(() => globalThis.__LV.teleportSpawn());
    await page.waitForTimeout(700);
  }
  // ================= Step 4 + weapons roster (9 weapons, 2 slots, given via debug like a supply drop)
  await lv(() => globalThis.__LV.setDrops(false));
  const WEAPONS = ['blaster', 'vector', 'scatter', 'vulcan', 'plasma', 'flamer', 'sniper', 'arc', 'rail', 'launcher', 'emp'];
  const DIGS = { flamer: false, plasma: false, emp: false };
  // every gun has its own voice
  const WEAPON_SFX = { blaster: 'shot', vector: 'beamOn', scatter: 'shotgun', vulcan: 'vulcan', plasma: 'plasma', flamer: 'flame', sniper: 'sniper', arc: 'arc', rail: 'rail', launcher: 'rocket', emp: 'empShot' };
  check('all 11 guns have different sounds', new Set(Object.values(WEAPON_SFX)).size === 11);
  const gunSizes = {}; // flamer burns rock instead (checked below); plasma blasts are tiny; emp doesn't dig
  for (const w of WEAPONS) {
    const sfxBefore = (await stats()).sfx;
    await lv(() => globalThis.__LV.resetHeat());
    const slot = await lv((w) => globalThis.__LV.giveWeapon(w), w);
    await setInput({ ...idle, weapon: slot, aimAngle: -Math.PI * 0.08 });
    await page.waitForTimeout(150);
    const before = await stats();
    check(`weapon ${w} in slot ${slot}`, before.weapon.id === w, `got ${before.weapon.id} slots=${JSON.stringify(before.weapon.slots)}`);
    // the drawn gun: its own size, and its barrel tip is exactly where the sim fires from
    gunSizes[w] = before.gun ? [before.gun.w, before.gun.h] : null;
    const tipErr = before.gun && before.muzzle ? Math.hypot(before.gun.tip.x - before.muzzle.x, before.gun.tip.y - before.muzzle.y) : 99;
    check(`weapon ${w}: rounds leave from the drawn barrel tip`, tipErr < 0.12, `tip=${JSON.stringify(before.gun?.tip)} muzzle=${JSON.stringify(before.muzzle)} err=${tipErr.toFixed(3)} units`);
    await setInput({ ...idle, weapon: slot, fire: true, aimAngle: -Math.PI * 0.08 });
    // sample the effect layers while the trigger is held: every gun must draw its own FX
    let fxPeak = { pixelFx: 0, bolts: 0, tracers: 0, particles: 0 };
    const until = Date.now() + (w === 'launcher' || w === 'rail' || w === 'emp' ? 900 : 650);
    let shotTaken = false;
    while (Date.now() < until) {
      const f = await stats();
      fxPeak = { pixelFx: Math.max(fxPeak.pixelFx, f.pixelFx), bolts: Math.max(fxPeak.bolts, f.bolts), tracers: Math.max(fxPeak.tracers, f.tracers), particles: Math.max(fxPeak.particles, f.particles) };
      if (!shotTaken && Date.now() > until - 420) {
        await shot(`3-weapon-${w}`);
        shotTaken = true;
      }
      await page.waitForTimeout(40);
    }
    {
      const snd = WEAPON_SFX[w];
      const after = (await stats()).sfx;
      check(`weapon ${w} plays its own sound (${snd})`, (after[snd] ?? 0) > (sfxBefore[snd] ?? 0), `${snd}: ${sfxBefore[snd] ?? 0} -> ${after[snd] ?? 0}`);
    }
    if (w === 'vector') check(`weapon ${w} draws its beam`, (await stats()).weapon.beamFiring || fxPeak.particles > 0, JSON.stringify(fxPeak));
    else if (w === 'arc') check(`weapon ${w} draws thunder bolts`, fxPeak.bolts > 0 && fxPeak.pixelFx > 0, JSON.stringify(fxPeak));
    else check(`weapon ${w} draws its pixel FX (flash / smoke / blast)`, fxPeak.pixelFx > 0, JSON.stringify(fxPeak));
    if (['blaster', 'scatter', 'vulcan', 'plasma', 'launcher', 'emp'].includes(w)) check(`weapon ${w} rounds are visible in flight`, fxPeak.tracers > 0, JSON.stringify(fxPeak));
    fpsLog[`w-${w}`] = await sampleFps(500);
    const after = await stats();
    if (DIGS[w] !== false) check(`weapon ${w} carves rock`, after.tilesDestroyed > before.tilesDestroyed, `+${after.tilesDestroyed - before.tilesDestroyed} tiles`);
    check(`weapon ${w} builds heat`, after.weapon.heat > 3, `heat=${after.weapon.heat.toFixed(0)}`);
    await setInput({ ...idle, weapon: slot, aimAngle: -Math.PI * 0.08 });
    await page.waitForTimeout(150);
  }
  {
    const sizes = Object.values(gunSizes).map((s) => (s ? s.join('x') : 'none'));
    const area = (w) => (gunSizes[w] ? gunSizes[w][0] * gunSizes[w][1] : 0);
    check('every gun is drawn at its own size', new Set(sizes).size === WEAPONS.length && !sizes.includes('none'), JSON.stringify(gunSizes));
    check('the launcher is the biggest gun', WEAPONS.every((w) => w === 'launcher' || area('launcher') > area(w)), JSON.stringify(gunSizes));
  }
  // your own blast hurts you: a rocket into the floor at your feet
  {
    await lv(() => globalThis.__LV.teleportSpawn());
    await page.waitForTimeout(800);
    await lv(() => globalThis.__LV.heal());
    await lv(() => globalThis.__LV.resetHeat());
    const ls = await lv(() => globalThis.__LV.giveWeapon('launcher'));
    await setInput({ ...idle, weapon: ls, aimAngle: Math.PI / 2 });
    await page.waitForTimeout(250);
    const hp0 = (await stats()).player.health;
    await setInput({ ...idle, weapon: ls, fire: true, aimAngle: Math.PI / 2 });
    await page.waitForTimeout(260);
    await setInput({ ...idle, weapon: ls, aimAngle: Math.PI / 2 });
    await page.waitForTimeout(500);
    const hp1 = (await stats()).player.health;
    check('a point-blank rocket hurts the one who fired it', hp0 - hp1 >= 20, `hp ${hp0} -> ${hp1}`);
    await lv(() => globalThis.__LV.heal());
  }
  // flamer: rock catches fire, then crumbles (from the spawn floor, flaming straight down at the ground under our feet)
  await lv(() => globalThis.__LV.teleportSpawn());
  await page.waitForTimeout(900);
  await lv(() => globalThis.__LV.resetHeat());
  const fslot = await lv(() => globalThis.__LV.giveWeapon('flamer'));
  const fb = await stats();
  await setInput({ ...idle, weapon: fslot, fire: true, aimAngle: Math.PI / 2 });
  await page.waitForTimeout(350);
  const fmid = await stats();
  await shot('3b-flamer-burning-rock');
  await setInput({ ...idle, weapon: fslot, aimAngle: Math.PI / 2 });
  await page.waitForTimeout(1100);
  const fa = await stats();
  check('flamer sets rock alight (tiles burning)', fmid.burningTiles > 0, `burning=${fmid.burningTiles}`);
  check('burning rock crumbles after the burn', fa.tilesDestroyed > fb.tilesDestroyed && fa.burningTiles === 0, `+${fa.tilesDestroyed - fb.tilesDestroyed} tiles, still burning=${fa.burningTiles}`);
  // terrain materials (Blastronaut): hard stone takes several hits, sand breaks in one and never falls
  {
    const m0 = await stats();
    check('the cave has hard stone and sand', m0.hardTiles > 40 && m0.sandTiles > 40, `hard=${m0.hardTiles} sand=${m0.sandTiles}`);
    const hit = await lv(() => globalThis.__LV.hitHardStone(2));
    check('a bullet only chips hard stone (it holds, with fewer hp)', hit && hit.material === 3 && hit.hp === 10, JSON.stringify(hit));
    await page.waitForTimeout(120);
    check('chipping stone plays the stone clink', ((await stats()).sfx.chip ?? 0) > (m0.sfx.chip ?? 0), `chip=${(await stats()).sfx.chip}`);
    let hp = hit?.hp ?? 0;
    for (let k = 0; k < 5 && hp > 0; k++) hp = (await lv(() => globalThis.__LV.hitHardStone(2)))?.hp ?? 0;
    check('…and breaks after 6 bullet hits', hp === 0, `hp=${hp}`);
    const sand = await lv(() => globalThis.__LV.undermineSand());
    await page.waitForTimeout(1200);
    await shot('3c-sand-stays');
    const still = sand ? await lv((p) => globalThis.__LV.tileAt(p.x, p.y), sand) : -1;
    check('sand stays put when the rock under it is dug out (no falling)', !!sand && still === 4, `sand=${JSON.stringify(sand)} tile now=${still}`);
    await lv(() => globalThis.__LV.teleportSpawn());
    await page.waitForTimeout(700);
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
  // back on the spawn floor for the bomb section (the weapon sweep may have carved the ground away).
  // This section checks what each bomb *does* (craters, fire, smoke, clusters) with charges going off
  // right next to the pilot; self-damage has its own checks, so the pilot is invulnerable here.
  await lv(() => globalThis.__LV.setGod(true));
  await lv(() => globalThis.__LV.teleportSpawn());
  await page.waitForTimeout(900);
  check('teleported to spawn and landed', (await stats()).player.grounded, `y=${(await stats()).player.y.toFixed(1)}`);
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
  check('bomb exploded and carved', sb2.bombsLive === 0 && sb2.tilesDestroyed > sb.tilesDestroyed + 3, `+${sb2.tilesDestroyed - sb.tilesDestroyed}`);
  // the map's own kit shows in the HUD (Hollow: gel / mine / smoke); tests below unlock every type
  const kitDots = await page.locator('[data-hud=bombs] .hud-bomb-dot').count();
  const kitLen = (await stats()).bombKit.length;
  check('HUD bomb counters match the map kit', kitDots === kitLen && kitLen === 3, `dots=${kitDots} kit=${kitLen}`);
  await lv(() => globalThis.__LV.unlockAllBombs());
  await page.waitForTimeout(150);
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
    check('fire mine detonates on proximity', sm2.bombsLive === 0, `live=${sm2.bombsLive}`);
    check('fire mine leaves a burning pool', sm2.fireClouds > 0, `fire=${sm2.fireClouds}`);
    await page.waitForTimeout(400);
    await shot('4e-fire-mine');
  }
  // smoke: throw, let it land and arm, then a frozen alien walks into it (deterministic regardless of where it rolled)
  await setInput({ ...idle, weapon: 0, bomb: true, bombType: 2, aimAngle: Math.PI / 2 - 0.15 });
  await page.waitForTimeout(120);
  await setInput({ ...idle, weapon: 0, bombType: 2, aimAngle: Math.PI / 2 - 0.15 });
  await page.waitForFunction(() => globalThis.__LV.stats().bombs.some((b) => b.type === 'smoke' && b.armed), null, { timeout: 4000 }).catch(() => {});
  const smokeBomb = (await stats()).bombs.find((b) => b.type === 'smoke');
  if (smokeBomb) await lv((b) => globalThis.__LV.spawnAlienAt('crawler', b.x + 0.5, b.y - 0.6, true), smokeBomb);
  await page.waitForFunction(() => globalThis.__LV.stats().clouds > 0, null, { timeout: 3000 }).catch(() => {});
  const ss = await stats();
  check('smoke bomb leaves a cloud', ss.clouds > 0, `clouds=${ss.clouds} bombs=${JSON.stringify(ss.bombs)}`);
  await shot('4b-smoke');
  // bomb selector: click a HUD bomb icon → that type is in hand; empty types are disabled
  // (the injected input must not pin bombType here, or the click can't win)
  await setInput({ moveX: 0, jet: false, fire: false, bomb: false, weapon: 0, aimAngle: 0 });
  await page.click('[data-hud=bombs] .hud-bomb-dot[data-bomb=mine]');
  await page.waitForTimeout(150);
  check('clicking a bomb icon selects that bomb', (await stats()).weapon.bombType === 'mine', `bombType=${(await stats()).weapon.bombType}`);
  await page.click('[data-hud=bombs] .hud-bomb-dot[data-bomb=gel]');
  await page.waitForTimeout(150);
  check('…and back to gel', (await stats()).weapon.bombType === 'gel', `bombType=${(await stats()).weapon.bombType} counts=${JSON.stringify((await stats()).bombCounts)}`);
  if (isMobile) check('mobile BOMB button shows the bomb in hand', (await page.locator('[data-action=m-bomb]').getAttribute('data-bomb')) === 'gel' && (await visible('[data-action=m-bomb] .mbtn-icon')));
  // cluster: pops into bomblets (bomb count spikes), all gone within ~2 s
  await setInput({ ...idle, weapon: 0, bomb: true, bombType: 3, aimAngle: -Math.PI / 2 });
  await page.waitForTimeout(120);
  await setInput({ ...idle, weapon: 0, bombType: 3, aimAngle: -Math.PI / 2 });
  let clusterPeak = 0;
  for (let i = 0; i < 14; i++) {
    clusterPeak = Math.max(clusterPeak, (await stats()).bombsLive);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(600);
  check('cluster bomb splits into bomblets', clusterPeak >= 5, `peak live bombs=${clusterPeak}`);
  check('cluster + bomblets all detonate', (await stats()).bombsLive === 0, `live=${(await stats()).bombsLive}`);
  // impact: thrown at the floor, gone (and carved) well inside a second
  const im0 = await stats();
  await setInput({ ...idle, weapon: 0, bomb: true, bombType: 4, aimAngle: Math.PI / 2 - 0.3 });
  await page.waitForTimeout(120);
  await setInput({ ...idle, weapon: 0, bombType: 4, aimAngle: Math.PI / 2 - 0.3 });
  await page.waitForTimeout(600);
  const im1 = await stats();
  check('impact charge detonates on contact (< 0.7 s) and carves', im1.bombsLive === 0 && im1.tilesDestroyed > im0.tilesDestroyed, `live=${im1.bombsLive} +${im1.tilesDestroyed - im0.tilesDestroyed} tiles`);
  // heavy: long fuse, huge plain blast (no fire), lobbed well away to the left
  const hv0 = await stats();
  await setInput({ ...idle, weapon: 0, bomb: true, bombType: 5, aimAngle: Math.PI - 0.35 });
  await page.waitForTimeout(120);
  await setInput({ ...idle, weapon: 0, bombType: 5, aimAngle: Math.PI - 0.35 });
  await page.waitForFunction(() => globalThis.__LV.stats().bombsLive === 0, null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(200);
  const hv1 = await stats();
  check('heavy charge is a plain blast (carves, no fire pool)', hv1.tilesDestroyed > hv0.tilesDestroyed + 3 && hv1.fireClouds === hv0.fireClouds && hv1.bombsLive === 0, `+${hv1.tilesDestroyed - hv0.tilesDestroyed} tiles fire=${hv1.fireClouds}`);
  await shot('4e-heavy');
  fpsLog.heavy = await sampleFps(600);
  const bombDots = await page.locator('[data-hud=bombs] .hud-bomb-dot').count();
  check('HUD shows a counter for each of the 6 bomb types once unlocked', bombDots === 6 && (await visible('[data-hud=bombs] .hud-bomb-icon')), `dots=${bombDots}`);
  await setInput({ ...idle, weapon: 0, bombType: 0, aimAngle: 0 });
  await page.waitForTimeout(400);
  await lv(() => globalThis.__LV.setGod(false));
  const healed = await lv(() => globalThis.__LV.heal());
  check('bomb tests left the player alive (healed for the next section)', healed === 100 && (await stats()).phase === 'playing', `hp=${healed}`);
  // regrow: carve a hole into rock away from the player, it heals within ~5 s
  await page.waitForTimeout(600);
  const rg0 = await stats();
  const carved = await lv(() => globalThis.__LV.carveRockNear(2)); // nearest fully solid patch (the cave is ~50% air)
  const rg1 = await stats();
  check('regrow test: carve made a hole', carved > 0 && rg1.solidTiles < rg0.solidTiles, `${rg0.solidTiles} -> ${rg1.solidTiles} (carved ${carved})`);
  await page.waitForTimeout(5200);
  const rg2 = await stats();
  check('carved rock regrows after ~4 s', rg2.solidTiles > rg1.solidTiles, `${rg1.solidTiles} -> ${rg2.solidTiles} (start ${rg0.solidTiles})`);
  check('regrown rock is rendered (tile sprites == solid tiles)', rg2.sprites === rg2.solidTiles, `sprites=${rg2.sprites} solid=${rg2.solidTiles}`);
  await shot('4d-regrown');
  // supply drop: spawn a crate above the player; it descends and gets picked up
  const dp0 = await stats();
  await lv(() => globalThis.__LV.spawnDrop('rail'));
  await lv(() => globalThis.__LV.spawnBombDrop('gel'));
  await page.waitForTimeout(200);
  const dp1 = await stats();
  check('weapon crate + bomb crate spawn above the player', dp1.drops === dp0.drops + 2 && dp1.dropList.some((d) => d.bomb === 'gel') && dp1.dropList.some((d) => d.weapon === 'rail'), JSON.stringify(dp1.dropList));
  const gelBefore = dp0.bombCounts[0];
  check('HUD weapon slots show weapon icons', (await page.locator('[data-hud=weapons] .hud-slot-icon').count()) >= 1);
  await shot('4c-crate');
  await page.waitForFunction(() => globalThis.__LV.stats().dropList.every((d) => d.landed), null, { timeout: 12000 }).catch(() => {});
  // walk over to the weapon crate (where it lands depends on the terrain around the pilot)
  {
    const rail = (await stats()).dropList.find((d) => d.weapon === 'rail');
    if (rail) await lv((d) => globalThis.__LV.teleportTo(d.x, d.y - 0.3), rail);
  }
  await page.waitForTimeout(400);
  const dpL = await stats();
  {
    const box = await page.locator('[data-action=take]').boundingBox().catch(() => null);
    const vp = page.viewportSize();
    const bg = await page.locator('[data-action=take]').evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => '');
    check('the TAKE button is small and round (Mini Militia), not a big orange card', !!box && !!vp && box.width <= Math.max(72, vp.width * 0.08) && Math.abs(box.width - box.height) < 4 && !/255, 184, 79/.test(bg), `box=${JSON.stringify(box)} vp=${vp?.width}x${vp?.height} bg=${bg}`);
  }
  check('landed crates are NOT auto-collected; a TAKE button appears', dpL.drops === dp0.drops + 2 && !dpL.weapon.slots.includes('rail') && !!dpL.player.nearDrop && (await visible('[data-action=take]')), `drops=${dpL.drops} near=${JSON.stringify(dpL.player.nearDrop)}`);
  await shot('4c2-take-button');
  // take both: walk to each crate in turn (they can land a few tiles apart), then tap TAKE
  for (const pick of [(d) => d.weapon === 'rail', (d) => d.bomb === 'gel']) {
    const d = (await stats()).dropList.find(pick);
    if (!d) continue;
    await lv((d) => globalThis.__LV.teleportTo(d.x, d.y - 0.3), d);
    const shown = await page.waitForSelector('[data-action=take]', { state: 'visible', timeout: 3000 }).then(() => true, () => false);
    if (shown) await page.click('[data-action=take]', { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(250);
  }
  const dp2 = await stats();
  check('TAKE swaps the weapon crate into a slot', dp2.weapon.slots.includes('rail'), `slots=${JSON.stringify(dp2.weapon.slots)} drops=${dp2.drops}`);
  check('TAKE on the bomb crate refills gel (+2, capped)', dp2.bombCounts[0] === Math.min(5, gelBefore + 2) && dp2.drops === dp0.drops, `gel ${gelBefore} -> ${dp2.bombCounts[0]} drops=${dp2.drops}`);
  // taking a crate of another bomb type puts that bomb in hand (the injected input must not pin bombType)
  await setInput({ moveX: 0, jet: false, fire: false, bomb: false, weapon: 0, aimAngle: 0 });
  await lv(() => globalThis.__LV.spawnBombDrop('smoke'));
  await page.waitForFunction(() => !!globalThis.__LV.stats().player.nearDrop, null, { timeout: 12000 }).catch(() => {});
  await page.keyboard.press('KeyG');
  await page.waitForTimeout(250);
  const sel = await stats();
  check('G takes the crate; its bomb becomes the bomb in hand', sel.weapon.bombType === 'smoke' && sel.drops === 0, `bombType=${sel.weapon.bombType} drops=${sel.drops}`);
  // EMP: a slow orb; anyone in its burst loses the jetpack for 10 s (fire it at our own feet)
  await lv(() => globalThis.__LV.resetHeat());
  const eslot = await lv(() => globalThis.__LV.giveWeapon('emp'));
  await setInput({ ...idle, weapon: eslot, fire: true, aimAngle: Math.PI / 2 });
  await page.waitForFunction(() => globalThis.__LV.stats().player.jammed > 0, null, { timeout: 4000 }).catch(() => {});
  await setInput({ ...idle, weapon: eslot, jet: true, aimAngle: -Math.PI / 2 });
  const j0 = await stats();
  await page.waitForTimeout(700);
  const j1 = await stats();
  check('EMP burst knocks the jetpack offline (~10 s)', j0.player.jammed > 7 && (await visible('[data-hud=jammed]')), `jammed=${j0.player.jammed?.toFixed(1)}`);
  check('jammed pilot cannot lift off', !j1.player.thrusting && j1.player.y > j0.player.y - 0.3, `dy=${(j1.player.y - j0.player.y).toFixed(2)} thrusting=${j1.player.thrusting}`);
  await shot('4g-emp-jammed');
  await lv(() => globalThis.__LV.unjam());
  await setInput({ ...idle, weapon: 0, aimAngle: 0 });
  await page.waitForTimeout(200);
  await shot('4f-lightning-beam-window');

  // ================= Step 5: aliens, kills, drops, waves
  await lv(() => globalThis.__LV.teleportSpawn());
  await page.waitForTimeout(900);
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

  // ================= scope zoom + enemy arrows
  const z0 = await stats();
  await page.keyboard.press('KeyZ');
  await page.waitForTimeout(700); // eases in over ~0.4 s
  const z1 = await stats();
  check('Z turns the scope on at the active weapon\'s level (gentle: view widens 1 + 0.25·(N−1))', z1.scoped && Math.abs(z1.cameraView.vw - z0.cameraView.vw * z1.scopeView) < 2 && z1.scopeView === 1 + 0.25 * (z1.scopeLevel - 1) && z1.phase === 'playing', `level=${z1.scopeLevel} mult=${z1.scopeView} view ${z0.cameraView.vw}→${z1.cameraView.vw}`);
  check('HUD shows the scope badge', (await page.locator('[data-hud=zoom]').innerText().catch(() => '')).includes(`${z1.scopeLevel}X`));
  // scope power follows the gun: sniper = 7x (the whole cave), blaster = 2x
  await lv(() => globalThis.__LV.giveWeapon('sniper'));
  await page.waitForTimeout(900);
  const zs = await stats();
  check('sniper scope is 7x = 2.5× view', zs.scopeLevel === 7 && Math.abs(zs.cameraView.vw - z0.cameraView.vw * 2.5) < z0.cameraView.vw * 0.01 && zs.weapon.id === 'sniper', `level=${zs.scopeLevel} view=${zs.cameraView.vw} (1x=${z0.cameraView.vw})`);
  await shot('5c-sniper-7x');
  fpsLog.sniper7x = await sampleFps(900);
  // smooth motion zoomed all the way out: every frame is on the even path (no hitch), and the
  // cave is cheap to draw (chunks are cached, not thousands of tile sprites)
  {
    const sl = (await stats()).weapon.active;
    await lv(() => globalThis.__LV.traceStart());
    await setInput({ ...idle, weapon: sl, moveX: 1, jet: true });
    await page.waitForTimeout(900);
    await setInput({ ...idle, weapon: sl, moveX: -1 });
    await page.waitForTimeout(700);
    await setInput({ ...idle, weapon: sl });
    const tr = await lv(() => globalThis.__LV.traceStop());
    let hitches = 0;
    // compare each frame with the straight line between its neighbours *in time* (frames can land late)
    for (let i = 1; i + 1 < tr.length; i++) {
      const k = (tr[i].t - tr[i - 1].t) / Math.max(1e-6, tr[i + 1].t - tr[i - 1].t);
      const ex = tr[i].wx - (tr[i - 1].wx + (tr[i + 1].wx - tr[i - 1].wx) * k);
      const ey = tr[i].wy - (tr[i - 1].wy + (tr[i + 1].wy - tr[i - 1].wy) * k);
      if (Math.max(Math.abs(ex), Math.abs(ey)) > 1.01) hitches++;
    }
    const ms = tr.map((f) => f.ms).sort((x, y) => x - y);
    const med = ms[Math.floor(ms.length / 2)] ?? 0;
    const moved = tr.length > 2 && (tr[0].wx !== tr[tr.length - 1].wx || tr[0].wy !== tr[tr.length - 1].wy);
    check('flying at 7x zoom-out is smooth (no hitches) and cheap to draw', moved && hitches === 0 && med < 6, `frames=${tr.length} hitches=${hitches} render median=${med.toFixed(2)} ms`);
    await lv(() => globalThis.__LV.teleportSpawn());
    await page.waitForTimeout(500);
  }
  await lv(() => globalThis.__LV.giveWeapon('blaster'));
  await page.waitForTimeout(700);
  const zb = await stats();
  check('switching to the blaster drops the scope to 2x = 1.25× view', zb.weapon.id === 'blaster' && zb.scopeLevel === 2 && Math.abs(zb.cameraView.vw - z0.cameraView.vw * 1.25) < 2, `weapon=${zb.weapon.id} level=${zb.scopeLevel} view=${zb.cameraView.vw}`);
  await shot('5b-zoom-out');
  fpsLog.zoomOut = await sampleFps(900);
  await page.keyboard.press('KeyZ');
  await page.waitForTimeout(700);
  const z2 = await stats();
  check('Z again turns the scope off', !z2.scoped && z2.zoom === 1 && Math.abs(z2.cameraView.vw - z0.cameraView.vw) < 1, `zoom=${z2.zoom}`);
  // an alien far to the right is off-screen at 1x → red edge arrow; a near one gets none
  await lv(() => globalThis.__LV.setWaves(false));
  await lv(() => globalThis.__LV.clearAliens());
  await lv(() => {
    const p = globalThis.__LV.stats().player;
    globalThis.__LV.spawnAlienAt('flyer', p.x + 45, p.y - 2, true);
  });
  await page.waitForTimeout(150);
  const zi = await stats();
  const arrow = zi.indicators.find((i) => i.kind === 'alien' && !i.onScreen);
  check('off-screen alien gets an edge arrow inside the view', !!arrow && arrow.x >= 0 && arrow.x <= zi.vw && arrow.y >= 0 && arrow.y <= zi.vh && arrow.x > zi.vw * 0.9, JSON.stringify(arrow));
  if (isMobile) check('mobile ZOOM button present', await visible('[data-action=m-zoom]'));

  // ================= Step 5/6: damage, pause, game over, retry
  const hp = await lv(() => globalThis.__LV.damagePlayer(30));
  check('player takes damage', hp <= 70, `health=${hp}`);
  await page.waitForTimeout(150);
  const hpText = await page.locator('[data-hud=health] .hud-seg.on').count();
  check('health bar reflects damage', hpText <= 7, `segments=${hpText}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  check('Escape pauses', (await stats()).phase === 'paused' && (await visible('[data-ui=pause]')));
  check('pause overlay carries the settings tabs', await visible('[data-ui=pause] [data-ui=settings]'));
  await shot('6-pause');
  await page.click('[data-action=resume]');
  await page.waitForTimeout(150);
  check('resume works', (await stats()).phase === 'playing');
  // in-game settings cog (replaces the old II button)
  const cogBox = await page.locator('[data-action=settings-cog]').boundingBox();
  check('in-game cog visible and finger-sized (≥ 40 px)', cogBox && cogBox.width >= 40 && cogBox.height >= 40 && (await visible('[data-action=settings-cog] .cog')), JSON.stringify(cogBox));
  check('old II pause button is gone', !(await visible('[data-action=m-pause]')));
  await page.click('[data-action=settings-cog]');
  await page.waitForTimeout(150);
  check('cog pauses and opens the in-game menu', (await stats()).phase === 'paused' && (await visible('[data-ui=pause]')));
  await page.click('[data-action=resume]');
  await page.waitForTimeout(150);
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
  // every map starts, plays, and looks different: rock density, palette, bomb kit
  const mapStats = {};
  for (const id of ['hollow', 'furnace', 'rift']) {
    await lv((id) => globalThis.__LV.start(id), id);
    await page.waitForTimeout(500);
    const ms = await stats();
    mapStats[id] = { solid: ms.solidTiles, biome: ms.biome, kit: ms.bombKit, phase: ms.phase, sky: ms.sky, topOpen: ms.topOpen };
    await shot(`9-map-${id}`);
    fpsLog[`map-${id}`] = await sampleFps(500);
  }
  const kits = Object.values(mapStats).map((m) => m.kit.join(','));
  const biomes = new Set(Object.values(mapStats).map((m) => m.biome));
  check('all four maps start and play', Object.values(mapStats).every((m) => m.phase === 'playing' && m.kit.length === 3), JSON.stringify(mapStats));
  check('three distinct palettes and bomb kits', biomes.size === 3 && new Set(kits).size === 3, `biomes=${[...biomes]} kits=${kits.join(' | ')}`);
  check('Rift has an open sky, caves a ceiling', Object.values(mapStats).every((m) => m.topOpen === m.sky) && mapStats.rift.sky && !mapStats.hollow.sky, JSON.stringify(Object.fromEntries(Object.entries(mapStats).map(([k, v]) => [k, [v.sky, v.topOpen]]))));
  check('Furnace is dense, Rift is open', mapStats.furnace.solid > mapStats.rift.solid + 800, `furnace=${mapStats.furnace.solid} rift=${mapStats.rift.solid} hollow=${mapStats.hollow.solid}`);
  await lv(() => globalThis.__LV.toMenu());
  await page.waitForTimeout(300);
  const statsAfter = await stats();
  check('render loop never threw (incl. world rebuilds on every map)', statsAfter.loopErrors === 0, `loopErrors=${statsAfter.loopErrors}`);
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
  if (!only || 'multiplayer'.includes(only) || 'capacity'.includes(only)) {
    process.stdout.write(`▶ multiplayer (2 tabs) ... `);
    let gs = null;
    try {
      gs = await startGameServer();
      if (!only || 'multiplayer'.includes(only)) {
        const r = await runMultiplayer(browser, server.url, gs.url);
        results.push(r);
        const failed = r.checks.filter((c) => !c.ok);
        console.log(`checks ${r.checks.length - failed.length}/${r.checks.length} | errors ${r.errors.length}`);
        for (const c of failed) console.log(`   ✗ ${c.name} — ${c.info}`);
        for (const e of r.errors) console.log(`   ! ${e}`);
      } else console.log('skipped');
      process.stdout.write(`▶ capacity (12 node clients) ... `);
      const rc = await runCapacity(gs.url);
      results.push(rc);
      const failedC = rc.checks.filter((c) => !c.ok);
      console.log(`checks ${rc.checks.length - failedC.length}/${rc.checks.length} | errors ${rc.errors.length}`);
      for (const c of failedC) console.log(`   ✗ ${c.name} — ${c.info}`);
      for (const e of rc.errors) console.log(`   ! ${e}`);
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
    md += `| ${r.scenario} | ${r.scenario === 'capacity' ? '12 node clients' : '2 tabs'} | | | | | | | ${r.fpsA?.toFixed(0) ?? '-'} | ${passed}/${r.checks.length} | ${r.errors.length} |\n`;
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
