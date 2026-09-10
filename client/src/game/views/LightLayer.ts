import { Geometry, Mesh, Shader, type Texture } from 'pixi.js';
import { BEAM, PPU } from '@shared/constants';
import type { Snapshot } from '@shared/sim/events';
import type { Camera } from '../engine/Camera';

interface Light {
  x: number; // screen px (virtual canvas)
  y: number;
  r: number;
  a: number;
  color: number;
}

const MAX_LIGHTS = 48;

const VERT = /* glsl */ `
in vec2 aPosition;
out vec2 vPos;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vPos = aPosition;
}`;

const FRAG = /* glsl */ `
in vec2 vPos;
uniform float uAmbient;
uniform float uCount;
uniform vec4 uLights[${MAX_LIGHTS}];  // x, y, radius, intensity
uniform vec4 uColors[${MAX_LIGHTS}];
void main() {
  vec3 light = vec3(1.0 - uAmbient);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (float(i) >= uCount) break;
    vec4 L = uLights[i];
    float d = distance(vPos, L.xy) / max(L.z, 1.0);
    float f = max(0.0, 1.0 - d * d);
    f *= f;
    light += uColors[i].rgb * (f * L.w);
  }
  gl_FragColor = vec4(min(light, vec3(1.0)), 1.0);
}`;

/**
 * Single-pass 2D lighting: a full-screen quad whose fragment shader sums
 * light blobs over an ambient base, multiplied onto the scene. No render
 * texture and no exotic blend modes, so it behaves the same on every GPU
 * (the previous render-texture approach broke on iPhone Safari).
 */
export class LightLayer {
  readonly mesh: Mesh<Geometry, Shader>;
  private geometry: Geometry;
  private shader: Shader;
  private lightsBuf = new Float32Array(MAX_LIGHTS * 4);
  private colorsBuf = new Float32Array(MAX_LIGHTS * 4);
  private frame: Light[] = [];
  private transient: { x: number; y: number; r: number; ttl: number; maxTtl: number; color: number }[] = [];
  /** 0 = no darkness, 1 = black outside lights */
  ambient = 0.62;
  enabled = true;
  /** world scale of the scene (scope zoom): light positions/radii are given in world px and mapped here */
  zoom = 1;
  /** tile grid width, to place burning-tile lights */
  gridW = 200;

  /** compatibility alias: Game adds `sprite` to the stage */
  get sprite(): Mesh<Geometry, Shader> {
    return this.mesh;
  }

  constructor(
    _renderer: unknown,
    _glow: Texture,
    private vw: number,
    private vh: number,
  ) {
    this.geometry = new Geometry({
      attributes: { aPosition: new Float32Array([0, 0, vw, 0, vw, vh, 0, vh]) },
      indexBuffer: new Uint16Array([0, 1, 2, 0, 2, 3]),
    });
    this.shader = Shader.from({
      gl: { vertex: VERT, fragment: FRAG, name: 'lv-lightmap' },
      resources: {
        lightUniforms: {
          uAmbient: { value: this.ambient, type: 'f32' },
          uCount: { value: 0, type: 'f32' },
          uLights: { value: this.lightsBuf, type: 'vec4<f32>', size: MAX_LIGHTS },
          uColors: { value: this.colorsBuf, type: 'vec4<f32>', size: MAX_LIGHTS },
        },
      },
    });
    this.mesh = new Mesh({ geometry: this.geometry, shader: this.shader });
    this.mesh.blendMode = 'multiply';
  }

  resize(vw: number, vh: number): void {
    this.vw = vw;
    this.vh = vh;
    const buf = this.geometry.getBuffer('aPosition');
    buf.data = new Float32Array([0, 0, vw, 0, vw, vh, 0, vh]);
    buf.update();
  }

  /** a light that fades over `ttl` seconds (explosions, muzzle flashes); position in units */
  flash(xUnits: number, yUnits: number, rPx: number, ttl: number, color = 0xffffff): void {
    this.transient.push({ x: xUnits * PPU, y: yUnits * PPU, r: rPx, ttl, maxTtl: ttl, color });
    if (this.transient.length > 24) this.transient.shift();
  }

  update(dt: number): void {
    for (let i = this.transient.length - 1; i >= 0; i--) {
      this.transient[i].ttl -= dt;
      if (this.transient[i].ttl <= 0) this.transient.splice(i, 1);
    }
  }

  reset(): void {
    this.transient.length = 0;
  }

  private add(x: number, y: number, r: number, a: number, color = 0xffffff): void {
    const z = this.zoom;
    x *= z;
    y *= z;
    r *= z;
    // cull lights fully off-screen
    if (x + r < 0 || y + r < 0 || x - r > this.vw || y - r > this.vh) return;
    this.frame.push({ x, y, r, a, color });
  }

  draw(snap: Snapshot, cam: Camera, menuMode: boolean, time: number, extra: { x: number; y: number; r: number; a: number; color: number }[] = []): void {
    this.mesh.visible = this.enabled;
    if (!this.enabled) return;
    const L = cam.left;
    const T = cam.top;
    this.frame.length = 0;
    for (const e of extra) this.add(e.x, e.y, e.r, e.a, e.color);
    // priority order: players, beams, transient, then everything else (truncated at MAX_LIGHTS)
    if (menuMode) this.add(this.vw / 2 / this.zoom, this.vh / 2 / this.zoom, (Math.max(this.vw, this.vh) * 0.75) / this.zoom, 0.9);
    for (const p of snap.players) {
      if (!p.alive) continue;
      const flick = 1 + Math.sin(time * 9 + p.x) * 0.03;
      this.add(p.x * PPU - L, p.y * PPU - T, 96 * flick, 1);
      if (p.thrusting) this.add(p.x * PPU - L, (p.y + 0.6) * PPU - T, 34, 0.9, 0xbff4ff);
      if (p.beamOn) {
        const mx = p.x + Math.cos(p.aimAngle) * BEAM.muzzleOffset;
        const my = p.y + Math.sin(p.aimAngle) * BEAM.muzzleOffset;
        const segs = 4;
        for (let i = 0; i <= segs; i++) {
          const t = i / segs;
          this.add((mx + (p.beamEndX - mx) * t) * PPU - L, (my + (p.beamEndY - my) * t) * PPU - T, i === segs ? 44 : 24, 0.8, 0xbff4ff);
        }
      }
    }
    for (const t of this.transient) this.add(t.x - L, t.y - T, t.r * (0.6 + 0.4 * (t.ttl / t.maxTtl)), t.ttl / t.maxTtl, t.color);
    for (const b of snap.bombs) this.add(b.x * PPU - L, b.y * PPU - T, b.armed && Math.sin(time * 8) > 0 ? 26 : 12, 0.8);
    for (const d of snap.drops) this.add(d.x * PPU - L, d.y * PPU - T, 40, 0.8);
    for (const c of snap.clouds) {
      if (c.kind === 'fire') this.add(c.x * PPU - L, c.y * PPU - T, c.r * PPU * 1.6, 0.85 + 0.15 * Math.sin(time * 11), 0xffa060);
      else this.add(c.x * PPU - L, c.y * PPU - T, c.r * PPU * 0.8, 0.35);
    }
    for (const a of snap.aliens) this.add(a.x * PPU - L, a.y * PPU - T, a.burning ? 40 : 14, a.burning ? 0.9 : 0.5, a.burning ? 0xffc080 : 0xffffff);
    for (let k = 0; k < snap.burning.length && k < 12; k++) {
      const i = snap.burning[k];
      this.add(((i % this.gridW) + 0.5) * PPU - L, (Math.floor(i / this.gridW) + 0.5) * PPU - T, 30, 0.8 + 0.2 * Math.sin(time * 15 + i), 0xffa050);
    }
    for (const k of snap.pickups) this.add(k.x * PPU - L, k.y * PPU - T, 14, 0.6);

    const n = Math.min(MAX_LIGHTS, this.frame.length);
    for (let i = 0; i < n; i++) {
      const l = this.frame[i];
      this.lightsBuf[i * 4] = l.x;
      this.lightsBuf[i * 4 + 1] = l.y;
      this.lightsBuf[i * 4 + 2] = l.r;
      this.lightsBuf[i * 4 + 3] = l.a;
      this.colorsBuf[i * 4] = ((l.color >> 16) & 255) / 255;
      this.colorsBuf[i * 4 + 1] = ((l.color >> 8) & 255) / 255;
      this.colorsBuf[i * 4 + 2] = (l.color & 255) / 255;
      this.colorsBuf[i * 4 + 3] = 1;
    }
    const u = this.shader.resources.lightUniforms.uniforms as { uAmbient: number; uCount: number };
    u.uAmbient = menuMode ? this.ambient * 0.6 : this.ambient;
    u.uCount = n;
    this.shader.resources.lightUniforms.update();
  }

  debugSize(): { rtW: number; rtH: number; spriteW: number; spriteH: number; vw: number; vh: number; enabled: boolean; lights: number } {
    return { rtW: this.vw, rtH: this.vh, spriteW: this.mesh.width, spriteH: this.mesh.height, vw: this.vw, vh: this.vh, enabled: this.enabled, lights: this.frame.length };
  }

  dispose(): void {
    this.mesh.destroy();
    this.geometry.destroy();
    this.shader.destroy();
  }
}
