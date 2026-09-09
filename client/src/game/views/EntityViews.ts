import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { ALIENS, PPU, type AlienKind, type BiomeId, BIOMES } from '@shared/constants';
import { BOMBS, WEAPONS } from '@shared/weapons';
import type { AlienSnap, BombSnap, CloudSnap, DropSnap, PickupSnap, PlayerSnap, Snapshot } from '@shared/sim/events';
import { astronautParts, bombPickupTexture, crateTextures, crawlerTextures, flyerTextures, fuelTexture, mineTexture, shardTexture, type AstronautParts } from '../sprites';

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
    this.gun.anchor.set(0, 0.5);
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
    const mineTex = { mine: mineTexture(BOMBS.mine.color), smoke: mineTexture(BOMBS.smoke.color) };

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
        v.gun.tint = WEAPONS[s.weapon].color;
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
        if (s.type === 'gel') {
          const r = 0.35 * PPU;
          c.addChild(new Graphics().circle(0, 0, r).fill(BOMBS.gel.color).circle(-r * 0.3, -r * 0.3, r * 0.3).fill({ color: 0xffffff, alpha: 0.6 }));
        } else {
          const sp = new Sprite(mineTex[s.type]);
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
        if (s.type === 'gel') {
          const rate = 4 + (1 - Math.max(0, s.fuse) / BOMBS.gel.fuseSec) * 24;
          v.alpha = 0.7 + 0.3 * Math.sin(time * rate);
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
        const box = new Sprite(crate.crate);
        box.anchor.set(0.5, 0.5);
        box.tint = 0xffffff;
        const glow = new Sprite(this.glow);
        glow.anchor.set(0.5);
        glow.blendMode = 'add';
        glow.tint = WEAPONS[s.weapon].color;
        glow.scale.set(22 / this.glow.width);
        glow.alpha = 0.5;
        c.addChild(glow, chute, box);
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
        v.alpha = s.landed ? 0.85 + 0.15 * Math.sin(time * 6) : 1;
      },
    );
    this.clouds = new KeyedViews<CloudSnap, Container>(
      (s) => {
        const c = new Container();
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
        return c;
      },
      (v, s, time) => {
        v.x = Math.round(s.x * PPU);
        v.y = Math.round(s.y * PPU);
        const fade = Math.min(1, s.ttl / 1.5);
        v.alpha = 0.9 * fade;
        v.rotation = time * 0.15;
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
