import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { ALIENS, PPU, type AlienKind, type BiomeId, BIOMES } from '@shared/constants';
import { BOMBS, WEAPONS } from '@shared/weapons';
import type { AlienSnap, BombSnap, CloudSnap, DropSnap, PickupSnap, PlayerSnap, Snapshot } from '@shared/sim/events';
import { astronautParts, bombPickupTexture, bombTexture, crateTextures, crawlerTextures, flameTextures, flyerTextures, fuelTexture, shardTexture, weaponTextures, type AstronautParts } from '../sprites';
import { BOMB_ORDER, type BombType, type WeaponId } from '@shared/weapons';

class KeyedViews<S extends { id: string }, V extends Container> {
  readonly container = new Container();
  protected views = new Map<string, V>();

  constructor(
    private readonly create: (s: S) => V,
    private readonly update: (v: V, s: S, time: number) => void,
  ) {}

  sync(list: S[], time: number): void {
    const seen = new Set<string>();
    for (const s of list) {
      seen.add(s.id);
      let v = this.views.get(s.id);
      if (!v) {
        v = this.create(s);
        this.views.set(s.id, v);
        this.container.addChild(v);
      }
      this.update(v, s, time);
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id)) {
        v.destroy({ children: true });
        this.views.delete(id);
      }
    }
  }

  get(id: string): V | undefined {
    return this.views.get(id);
  }

  get size(): number {
    return this.views.size;
  }

  dispose(): void {
    this.container.destroy({ children: true });
    this.views.clear();
  }
}

/**
 * Humanoid astronaut: legs (walk cycle / jet tuck), torso, head, and an arm
 * that pivots at the shoulder to point the gun where the player aims.
 * Sprite is ~10x19 px; origin at the body centre.
 */
class PlayerSprite extends Container {
  readonly legs: Sprite;
  readonly torso: Sprite;
  readonly head: Sprite;
  readonly armPivot = new Container();
  readonly arm: Sprite;
  readonly gun: Sprite;
  readonly bodyGroup = new Container();
  walk = 0;

  constructor(parts: AstronautParts) {
    super();
    this.legs = new Sprite(parts.legs[0]);
    this.legs.anchor.set(0.5, 0);
    this.legs.y = 3;
    this.torso = new Sprite(parts.torso);
    this.torso.anchor.set(0.5, 1);
    this.torso.y = 4;
    this.head = new Sprite(parts.head);
    this.head.anchor.set(0.5, 1);
    this.head.y = -3;
    this.arm = new Sprite(parts.arm);
    this.arm.anchor.set(0, 0.5);
    this.gun = new Sprite(parts.gun);
    this.gun.anchor.set(0.15, 0.55); // grip sits in the glove
    this.gun.x = 6;
    this.armPivot.addChild(this.arm, this.gun);
    this.armPivot.y = -1; // shoulder
    this.bodyGroup.addChild(this.legs, this.torso, this.head);
    this.addChild(this.bodyGroup, this.armPivot);
  }
}

export class EntityViews {
  readonly container = new Container();
  readonly players: KeyedViews<PlayerSnap, PlayerSprite>;
  readonly aliens: KeyedViews<AlienSnap, Sprite>;
  readonly bombs: KeyedViews<BombSnap, Container>;
  readonly pickups: KeyedViews<PickupSnap, Sprite>;
  readonly drops: KeyedViews<DropSnap, Container>;
  readonly clouds: KeyedViews<CloudSnap, Container>;
  private frames: Record<AlienKind, Texture[]>;
  private readonly weaponTex: Record<WeaponId, Texture>;
  private readonly flames: Texture[];
  private animPhase = new Map<string, number>();
  private readonly parts = astronautParts();

  constructor(
    biome: BiomeId,
    private readonly glow: Texture,
  ) {
    const p = BIOMES[biome];
    this.frames = {
      crawler: crawlerTextures(ALIENS.crawler.color, ALIENS.crawler.accent),
      flyer: flyerTextures(ALIENS.flyer.color, ALIENS.flyer.accent),
    };
    const pickupTex = { shard: shardTexture(p.fringe), fuel: fuelTexture(), bomb: bombPickupTexture(0x4fe3ff) };
    const crate = crateTextures();
    this.weaponTex = weaponTextures();
    this.flames = flameTextures();
    const bombTex = Object.fromEntries([...BOMB_ORDER, 'bomblet'].map((b) => [b, bombTexture(b as BombType)])) as Record<BombType, Texture>;

    this.players = new KeyedViews<PlayerSnap, PlayerSprite>(
      () => new PlayerSprite(this.parts),
      (v, s, time) => {
        v.x = Math.round(s.x * PPU);
        v.y = Math.round(s.y * PPU);
        v.visible = s.alive;
        const facing = s.facing;
        v.bodyGroup.scale.x = facing;
        // legs: walk cycle from horizontal speed; tuck while thrusting/airborne
        const speed = Math.abs(s.vx);
        let frame = 0;
        if (s.thrusting || (!s.grounded && Math.abs(s.vy) > 2)) frame = 3;
        else if (speed > 0.8 && s.grounded) {
          v.walk += speed * 0.02;
          frame = 1 + (Math.floor(v.walk * 6) % 2);
        }
        v.legs.texture = this.parts.legs[frame];
        // arm + gun point at the aim; flip the arm vertically when aiming left so the gun stays upright
        v.armPivot.rotation = s.aimAngle;
        v.armPivot.scale.y = Math.cos(s.aimAngle) < 0 ? -1 : 1;
        v.gun.texture = this.weaponTex[s.weapon] ?? v.gun.texture;
        // recoil bob while firing the beam
        v.armPivot.x = s.beamOn ? Math.round(Math.sin(time * 40)) : 0;
        // hurt / invulnerability flash
        const tint = s.invuln > 0.6 ? 0xff4f5e : 0xffffff;
        v.head.tint = v.torso.tint = v.legs.tint = v.arm.tint = tint;
        v.alpha = s.invuln > 0 ? 0.55 + 0.45 * Math.abs(Math.sin(s.invuln * 30)) : 1;
      },
    );
    this.aliens = new KeyedViews<AlienSnap, Sprite>(
      (s) => {
        const sp = new Sprite(this.frames[s.kind][0]);
        sp.anchor.set(0.5, 0.6);
        this.animPhase.set(s.id, Math.random() * 10);
        return sp;
      },
      (v, s, time) => {
        v.x = Math.round(s.x * PPU);
        v.y = Math.round(s.y * PPU);
        const moving = Math.hypot(s.vx, s.vy) > 0.5;
        const ph = this.animPhase.get(s.id) ?? 0;
        v.texture = this.frames[s.kind][moving && Math.floor((time + ph) * 8) % 2 === 1 ? 1 : 0];
        if (Math.abs(s.vx) > 0.2) v.scale.x = s.vx < 0 ? -1 : 1;
        v.alpha = s.flash ? 0.4 : 1;
        v.tint = s.burning ? 0xffb060 : 0xffffff;
      },
    );
    this.bombs = new KeyedViews<BombSnap, Container>(
      (s) => {
        const c = new Container();
        const def = BOMBS[s.type];
        if (def.fuseSec > 0 || def.impact) {
          // thrown charges: sprite + soft glow that pulses faster as the fuse runs down
          const sp = new Sprite(bombTex[s.type]);
          sp.anchor.set(0.5);
          sp.label = 'body';
          const glow = new Sprite(this.glow);
          glow.anchor.set(0.5);
          glow.blendMode = 'add';
          glow.tint = def.color;
          glow.scale.set(9 / this.glow.width);
          glow.alpha = 0.35;
          c.addChild(glow, sp);
        } else {
          const sp = new Sprite(bombTex[s.type]);
          sp.anchor.set(0.5, 0.9);
          const light = new Sprite(this.glow);
          light.anchor.set(0.5);
          light.blendMode = 'add';
          light.tint = BOMBS[s.type].color;
          light.scale.set(10 / this.glow.width);
          light.y = -4;
          light.label = 'light';
          c.addChild(sp, light);
        }
        return c;
      },
      (v, s, time) => {
        v.x = Math.round(s.x * PPU);
        v.y = Math.round(s.y * PPU);
        const def = BOMBS[s.type];
        if (def.fuseSec > 0 || def.impact) {
          const rate = def.fuseSec > 0 ? 4 + (1 - Math.max(0, s.fuse) / def.fuseSec) * 24 : 10;
          v.alpha = 0.7 + 0.3 * Math.sin(time * rate);
          const body = v.getChildByLabel('body') as Sprite | null;
          if (body) body.rotation = time * (def.impact ? 6 : 4);
        } else {
          const light = v.getChildByLabel('light') as Sprite | null;
          if (light) light.alpha = s.armed ? (Math.sin(time * 8) > 0 ? 0.9 : 0.15) : 0.25;
        }
      },
    );
    this.pickups = new KeyedViews<PickupSnap, Sprite>(
      (s) => {
        const sp = new Sprite(pickupTex[s.kind]);
        sp.anchor.set(0.5);
        return sp;
      },
      (v, s, time) => {
        v.x = Math.round(s.x * PPU);
        v.y = Math.round(s.y * PPU + Math.sin(time * 6 + v.x) * 1.5);
        v.alpha = s.age > 22 ? 0.4 + 0.6 * Math.abs(Math.sin(time * 10)) : 1;
      },
    );
    this.drops = new KeyedViews<DropSnap, Container>(
      (s) => {
        const c = new Container();
        const chute = new Sprite(crate.chute);
        chute.anchor.set(0.5, 1);
        chute.y = -5;
        chute.label = 'chute';
        // the cargo itself hangs under the chute (harness lines drawn above it): a weapon, or a bomb (drawn 2x so it reads)
        const box = new Sprite(s.weapon ? (this.weaponTex[s.weapon] ?? crate.crate) : s.bomb ? bombTex[s.bomb] : crate.crate);
        box.anchor.set(0.5, 0.5);
        if (s.bomb) box.scale.set(1.25); // bombs are small; the glow does the signalling
        box.label = 'weapon';
        const lines = new Graphics().moveTo(-6, -5).lineTo(-3, 0).moveTo(6, -5).lineTo(3, 0).stroke({ color: 0x8f95a8, width: 1 });
        lines.label = 'lines';
        const glow = new Sprite(this.glow);
        glow.anchor.set(0.5);
        glow.blendMode = 'add';
        glow.tint = s.weapon ? WEAPONS[s.weapon].color : s.bomb ? BOMBS[s.bomb].color : 0xffffff;
        glow.scale.set(22 / this.glow.width);
        glow.alpha = 0.5;
        c.addChild(glow, chute, lines, box);
        return c;
      },
      (v, s, time) => {
        v.x = Math.round(s.x * PPU);
        v.y = Math.round(s.y * PPU);
        const chute = v.getChildByLabel('chute') as Sprite | null;
        if (chute) {
          chute.visible = !s.landed;
          chute.rotation = Math.sin(time * 2) * 0.12;
        }
        const lines = v.getChildByLabel('lines');
        if (lines) lines.visible = !s.landed;
        const w = v.getChildByLabel('weapon') as Sprite | null;
        if (w) {
          // sway under the chute while falling; lie flat and bob once landed
          w.rotation = s.landed ? 0 : Math.sin(time * 2) * 0.12;
          w.y = s.landed ? Math.round(Math.sin(time * 5) * 1) : 0;
        }
        v.alpha = s.landed ? 0.85 + 0.15 * Math.sin(time * 6) : 1;
      },
    );
    this.clouds = new KeyedViews<CloudSnap, Container>(
      (s) => {
        const c = new Container();
        if (s.kind === 'fire') {
          // a burning pool: a low ember glow hugging the ground and a row of licking flames across its width
          const glow = new Sprite(this.glow);
          glow.anchor.set(0.5);
          glow.blendMode = 'add';
          glow.tint = 0xff7a2b;
          glow.alpha = 0.35;
          glow.scale.set((s.r * PPU * 2.2) / this.glow.width, (s.r * PPU * 0.9) / this.glow.width);
          glow.label = 'glow';
          c.addChild(glow);
          const n = Math.max(4, Math.round(s.r * 3));
          for (let i = 0; i < n; i++) {
            const f = new Sprite(this.flames[i % 3]);
            f.anchor.set(0.5, 1);
            const t = n === 1 ? 0 : i / (n - 1) - 0.5;
            f.x = Math.round(t * s.r * PPU * 1.7 + (Math.random() - 0.5) * 4);
            f.y = Math.round(Math.abs(t) * 3 + 4);
            const sc = 0.8 + (1 - Math.abs(t) * 1.2) * 0.9 + Math.random() * 0.3;
            f.scale.set(sc, sc);
            (f as Sprite & { phase: number; base: number }).phase = Math.random() * 10;
            (f as Sprite & { phase: number; base: number }).base = sc;
            f.label = 'flame';
            c.addChild(f);
          }
        } else {
          for (let i = 0; i < 7; i++) {
            const puff = new Sprite(this.glow);
            puff.anchor.set(0.5);
            puff.tint = 0x8a93a3;
            puff.alpha = 0.55;
            const a = (i / 7) * Math.PI * 2;
            const d = i === 0 ? 0 : s.r * PPU * 0.45;
            puff.x = Math.cos(a) * d;
            puff.y = Math.sin(a) * d;
            puff.scale.set((s.r * PPU * 1.1) / this.glow.width);
            c.addChild(puff);
          }
        }
        return c;
      },
      (v, s, time) => {
        v.x = Math.round(s.x * PPU);
        v.y = Math.round(s.y * PPU);
        const fade = Math.min(1, s.ttl / 1.5);
        if (s.kind === 'fire') {
          v.alpha = fade;
          // flames flicker: cycle frames, stretch and lean with a per-flame phase
          for (const ch of v.children) {
            if (ch.label !== 'flame') {
              if (ch.label === 'glow') ch.alpha = 0.3 + 0.1 * Math.sin(time * 11);
              continue;
            }
            const f = ch as Sprite & { phase: number; base: number };
            f.texture = this.flames[Math.floor((time * 12 + f.phase) % 3)];
            f.scale.y = f.base * (0.85 + 0.3 * Math.abs(Math.sin(time * 9 + f.phase)));
            f.scale.x = f.base * (Math.sin(time * 5 + f.phase) > 0 ? 1 : -1);
            f.skew.x = Math.sin(time * 4 + f.phase) * 0.18;
          }
        } else {
          v.alpha = 0.9 * fade;
          v.rotation = time * 0.15;
        }
      },
    );
    this.container.addChild(this.pickups.container, this.drops.container, this.aliens.container, this.bombs.container, this.players.container, this.clouds.container);
  }

  sync(snap: Snapshot, time: number): void {
    this.players.sync(snap.players, time);
    this.aliens.sync(snap.aliens, time);
    this.bombs.sync(snap.bombs, time);
    this.pickups.sync(snap.pickups, time);
    this.drops.sync(snap.drops, time);
    this.clouds.sync(snap.clouds, time);
  }

  dispose(): void {
    this.container.destroy({ children: true });
  }
}
