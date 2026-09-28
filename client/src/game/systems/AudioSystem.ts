export type SfxName =
  // guns: every weapon has its own voice
  | 'shot' // blaster
  | 'shotgun' // scatter
  | 'vulcan'
  | 'arc'
  | 'thunder'
  | 'sniper'
  | 'plasma'
  | 'empShot'
  | 'rocket' // launcher
  | 'flame'
  | 'rail'
  | 'beamOn'
  | 'beamOff'
  | 'explosion'
  | 'bigExplosion'
  | 'overheat'
  // terrain
  | 'tile'
  | 'chip'
  | 'stoneBreak'
  | 'regrow'
  // pilots
  | 'hurt'
  | 'hurtOther'
  | 'death'
  | 'deathOther'
  | 'kill'
  | 'respawn'
  // everything else
  | 'pickup'
  | 'fuel'
  | 'alienHit'
  | 'alienDie'
  | 'wave'
  | 'unlock'
  | 'crate'
  | 'weaponPickup'
  | 'mineArm'
  | 'smoke'
  | 'ui';

/** where a sound comes from, relative to the listener: pan -1..1, vol 0..1 */
export interface SfxAt {
  pan?: number;
  vol?: number;
}

type Out = AudioNode;

/** minimum ms between two plays of the same sound (spammy ones) */
const MIN_GAP: Partial<Record<SfxName, number>> = {
  vulcan: 45,
  tile: 60,
  chip: 60,
  stoneBreak: 70,
  alienHit: 50,
  flame: 90,
  regrow: 120,
  thunder: 260,
  arc: 40,
  hurtOther: 120,
};

/**
 * Procedural SFX synth on WebAudio. No files to load, works offline and inside
 * the CrazyGames sandbox. Every voice runs through a small cave reverb, and
 * sounds from other pilots are panned + faded by distance (multiplayer).
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** dry + reverb send; every voice ends here */
  private bus: GainNode | null = null;
  private beamOsc: OscillatorNode | null = null;
  private beamGain: GainNode | null = null;
  private lastPlay = new Map<SfxName, number>();
  private noiseBuf: AudioBuffer | null = null;
  muted = false;
  /** how many times each sound was requested (debug / headless checks) */
  readonly log: Partial<Record<SfxName, number>> = {};

  /** Call from a user gesture (click/touch/key) — browsers require it. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      // gentle limiter so stacked explosions don't clip
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.ratio.value = 6;
      this.master.connect(comp).connect(ctx.destination);
      this.bus = ctx.createGain();
      this.bus.connect(this.master);
      // cave reverb: a short synthetic impulse (decaying noise), mixed in quietly
      const verb = ctx.createConvolver();
      const len = Math.floor(ctx.sampleRate * 1.3);
      const ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = ir.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6;
      }
      verb.buffer = ir;
      const wet = ctx.createGain();
      wet.gain.value = 0.22;
      this.bus.connect(verb).connect(wet).connect(this.master);
      // one shared white-noise buffer (2 s) for every noise voice
      this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const nd = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  /** a per-play output: gain (distance) → stereo pan → bus */
  private voice(at: SfxAt): Out | null {
    if (!this.ctx || !this.bus) return null;
    const g = this.ctx.createGain();
    g.gain.value = at.vol ?? 1;
    if (at.pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, at.pan));
      g.connect(p).connect(this.bus);
    } else g.connect(this.bus);
    return g;
  }

  private tone(
    out: Out,
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    slideTo?: number,
    delay = 0,
    attack = 0.002,
  ): void {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(out);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  /** filtered noise burst; `sweepTo` slides the filter frequency over the burst */
  private noise(
    out: Out,
    dur: number,
    vol: number,
    freq = 1200,
    delay = 0,
    type: BiquadFilterType = 'lowpass',
    sweepTo?: number,
    q = 0.8,
    attack = 0.002,
  ): void {
    if (!this.ctx || !this.noiseBuf) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(30, sweepTo), t0 + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.02);
  }

  /**
   * A cartoon pilot yell (Mini Militia style): a buzzy voice through "aah" formants, pitch
   * jumping up then falling, a breathy edge, and the thud of the body hitting the ground.
   * `pitch` varies the voice per pilot.
   */
  private yell(out: Out, pitch: number, vol: number, dur = 0.62, thud = true): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const f0 = 150 * pitch;
    const src = ctx.createOscillator();
    src.type = 'sawtooth';
    src.frequency.setValueAtTime(f0 * 1.25, t0);
    src.frequency.linearRampToValueAtTime(f0 * 1.6, t0 + 0.09);
    src.frequency.exponentialRampToValueAtTime(f0 * 0.62, t0 + dur);
    // vibrato + a bit of roughness
    const vib = ctx.createOscillator();
    const vibG = ctx.createGain();
    vib.frequency.value = 7 + Math.random() * 3;
    vibG.gain.value = f0 * 0.05;
    vib.connect(vibG).connect(src.frequency);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(vol, t0 + 0.03);
    env.gain.setValueAtTime(vol, t0 + dur * 0.55);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    // "aah" → "uh" formants
    const formants: [number, number, number, number][] = [
      [800, 620, 6, 1],
      [1200, 1000, 8, 0.6],
      [2600, 2400, 10, 0.25],
    ];
    for (const [fa, fb, q, amp] of formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(fa * (0.9 + pitch * 0.1), t0);
      bp.frequency.linearRampToValueAtTime(fb * (0.9 + pitch * 0.1), t0 + dur);
      bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = amp * 3;
      src.connect(bp).connect(g).connect(env);
    }
    env.connect(out);
    src.start(t0);
    vib.start(t0);
    src.stop(t0 + dur + 0.05);
    vib.stop(t0 + dur + 0.05);
    this.noise(out, dur * 0.7, vol * 0.25, 1400, 0, 'bandpass', 900, 1.5, 0.02);
    if (thud) {
      this.tone(out, 110, 0.18, 'sine', vol * 1.1, 40, dur * 0.8);
      this.noise(out, 0.12, vol * 0.5, 500, dur * 0.8);
    }
  }

  play(name: SfxName, at: SfxAt = {}): void {
    this.log[name] = (this.log[name] ?? 0) + 1;
    if (!this.ctx || this.muted) return;
    if ((at.vol ?? 1) < 0.03) return; // too far away to hear
    // rate-limit spammy sounds
    const now = performance.now();
    const minGap = MIN_GAP[name] ?? 0;
    if (minGap && now - (this.lastPlay.get(name) ?? 0) < minGap) return;
    this.lastPlay.set(name, now);
    if (name === 'beamOn') return this.startBeam();
    if (name === 'beamOff') return this.stopBeam();
    const o = this.voice(at);
    if (!o) return;
    const r = Math.random();

    switch (name) {
      // ------------------------------------------------------------ guns
      case 'shot': // BLASTER: bright laser "pew"
        this.tone(o, 1500 + r * 150, 0.1, 'square', 0.16, 380);
        this.tone(o, 3000, 0.03, 'sine', 0.08, 1200);
        this.noise(o, 0.03, 0.12, 5000, 0, 'highpass');
        break;
      case 'shotgun': // SCATTER: boom + pump "chk-chk"
        this.noise(o, 0.32, 0.9, 2600, 0, 'lowpass', 350);
        this.tone(o, 130, 0.22, 'sine', 0.7, 42);
        this.noise(o, 0.03, 0.25, 3500, 0.32, 'highpass');
        this.noise(o, 0.035, 0.3, 2800, 0.42, 'highpass');
        break;
      case 'vulcan': // minigun: a hard short "brt"
        this.noise(o, 0.045, 0.45, 1600 + r * 400, 0, 'bandpass', undefined, 1.4);
        this.tone(o, 170 + r * 30, 0.04, 'square', 0.14, 90);
        break;
      case 'sniper': // whip crack, heavy boom, long echo, then the bolt
        this.noise(o, 0.07, 1.0, 3200, 0, 'highpass');
        this.noise(o, 0.5, 0.7, 900, 0.01, 'lowpass', 120);
        this.tone(o, 90, 0.35, 'sine', 0.6, 35);
        this.noise(o, 0.04, 0.22, 3000, 0.55, 'highpass');
        this.tone(o, 900, 0.03, 'square', 0.06, 700, 0.62);
        break;
      case 'rocket': // LAUNCHER: thump + rising whoosh
        this.tone(o, 110, 0.18, 'sine', 0.6, 50);
        this.noise(o, 0.5, 0.45, 400, 0, 'bandpass', 1800, 1.2, 0.04);
        this.tone(o, 70, 0.45, 'sawtooth', 0.12, 55);
        break;
      case 'plasma': // wobbling "bwow"
        this.tone(o, 820 + r * 120, 0.16, 'sine', 0.3, 190);
        this.tone(o, 410 + r * 60, 0.14, 'triangle', 0.18, 95);
        this.noise(o, 0.1, 0.12, 6000, 0, 'highpass');
        break;
      case 'empShot': // charging hum that rises into a crackle
        this.tone(o, 110, 0.4, 'sawtooth', 0.18, 760, 0, 0.05);
        this.tone(o, 55, 0.4, 'square', 0.08, 380, 0, 0.05);
        this.noise(o, 0.2, 0.2, 5000, 0.2, 'highpass');
        break;
      case 'flame': // roaring gas
        this.noise(o, 0.2, 0.26, 700 + r * 200, 0, 'lowpass', 500, 0.6, 0.03);
        this.noise(o, 0.12, 0.08, 3000, 0, 'bandpass', undefined, 0.8);
        break;
      case 'rail': // charge "zip", snap, metal ring
        this.tone(o, 2400, 0.22, 'sawtooth', 0.22, 180);
        this.noise(o, 0.16, 0.5, 4000, 0, 'highpass');
        this.tone(o, 3300, 0.5, 'sine', 0.08, 3100, 0.02);
        this.tone(o, 95, 0.25, 'sine', 0.4, 40);
        break;
      case 'arc': // electric crackle
        this.noise(o, 0.07, 0.35, 4500, 0, 'bandpass', 2500, 2);
        this.tone(o, 1800 + r * 900, 0.06, 'sawtooth', 0.1, 350);
        this.tone(o, 60, 0.05, 'square', 0.1);
        break;
      case 'thunder': // sharp crack, then a low rolling rumble
        this.noise(o, 0.09, 0.7, 6000, 0, 'highpass');
        this.tone(o, 2400, 0.05, 'square', 0.1, 600);
        this.noise(o, 0.9, 0.45, 300, 0.05, 'lowpass', 90, 0.8, 0.05);
        this.tone(o, 68, 0.7, 'sine', 0.35, 32, 0.04);
        break;
      case 'explosion':
        this.noise(o, 0.6, 0.9, 1100, 0, 'lowpass', 160);
        this.tone(o, 85, 0.45, 'sine', 0.7, 30);
        this.noise(o, 0.35, 0.18, 2500, 0.12, 'bandpass', 900, 0.7); // debris rattle
        break;
      case 'bigExplosion':
        this.noise(o, 1.1, 1.0, 900, 0, 'lowpass', 90);
        this.tone(o, 60, 0.9, 'sine', 0.9, 22);
        this.noise(o, 0.12, 0.6, 3000, 0, 'highpass');
        this.noise(o, 0.6, 0.25, 2200, 0.2, 'bandpass', 700, 0.7);
        break;
      case 'overheat':
        this.tone(o, 400, 0.25, 'square', 0.15, 120);
        this.noise(o, 0.35, 0.25, 5000, 0.05, 'highpass', 1500);
        break;
      // ------------------------------------------------------------ terrain
      case 'tile':
        this.noise(o, 0.07, 0.18, 700);
        break;
      case 'chip': // stone clink
        this.tone(o, 2300 + r * 500, 0.09, 'triangle', 0.14, 1800);
        this.noise(o, 0.03, 0.15, 4000, 0, 'highpass');
        break;
      case 'stoneBreak': // heavy crunch
        this.noise(o, 0.28, 0.55, 800, 0, 'lowpass', 200);
        this.tone(o, 95, 0.14, 'square', 0.12, 50);
        this.noise(o, 0.15, 0.2, 2400, 0.05, 'bandpass', undefined, 1.2);
        break;
      case 'regrow':
        this.tone(o, 140, 0.12, 'triangle', 0.08, 260);
        break;
      // ------------------------------------------------------------ pilots
      case 'hurt': // our grunt + the hit
        this.yell(o, 1 + r * 0.1, 0.22, 0.18, false);
        this.noise(o, 0.1, 0.3, 1500);
        break;
      case 'hurtOther':
        this.yell(o, 0.9 + r * 0.3, 0.16, 0.16, false);
        break;
      case 'death': // our own death: the yell, full volume, plus a low drone
        this.yell(o, 1, 0.34);
        this.tone(o, 220, 0.9, 'sawtooth', 0.08, 50, 0.1);
        break;
      case 'deathOther': // someone else dies: their yell (a different voice each time)
        this.yell(o, 0.8 + r * 0.5, 0.3);
        break;
      case 'kill': // kill confirmed: two-note chime
        this.tone(o, 1320, 0.09, 'square', 0.1);
        this.tone(o, 1980, 0.16, 'square', 0.1, undefined, 0.08);
        break;
      case 'respawn': // rising shimmer
        this.tone(o, 300, 0.4, 'triangle', 0.14, 1200, 0, 0.05);
        this.noise(o, 0.35, 0.1, 3000, 0, 'bandpass', 8000, 1, 0.1);
        break;
      // ------------------------------------------------------------ everything else
      case 'pickup':
        this.tone(o, 880, 0.06, 'square', 0.12);
        this.tone(o, 1320, 0.08, 'square', 0.12, undefined, 0.05);
        break;
      case 'fuel':
        this.tone(o, 520, 0.08, 'triangle', 0.15);
        this.tone(o, 780, 0.12, 'triangle', 0.15, undefined, 0.07);
        break;
      case 'alienHit':
        this.tone(o, 300 + r * 100, 0.05, 'square', 0.08, 150);
        break;
      case 'alienDie':
        this.noise(o, 0.2, 0.3, 900);
        this.tone(o, 500, 0.2, 'sawtooth', 0.15, 80);
        break;
      case 'wave':
        this.tone(o, 330, 0.15, 'square', 0.15);
        this.tone(o, 440, 0.15, 'square', 0.15, undefined, 0.15);
        this.tone(o, 660, 0.3, 'square', 0.15, undefined, 0.3);
        break;
      case 'unlock':
        this.tone(o, 660, 0.1, 'triangle', 0.15);
        this.tone(o, 880, 0.1, 'triangle', 0.15, undefined, 0.1);
        this.tone(o, 1320, 0.25, 'triangle', 0.15, undefined, 0.2);
        break;
      case 'crate':
        this.tone(o, 300, 0.12, 'square', 0.12, 240);
        break;
      case 'weaponPickup': // cocking the new gun
        this.noise(o, 0.03, 0.3, 3000, 0, 'highpass');
        this.noise(o, 0.04, 0.35, 2200, 0.09, 'highpass');
        this.tone(o, 780, 0.08, 'square', 0.1, undefined, 0.12);
        break;
      case 'mineArm':
        this.tone(o, 1200, 0.06, 'square', 0.1);
        break;
      case 'smoke':
        this.noise(o, 0.6, 0.35, 600);
        break;
      case 'ui':
        this.tone(o, 1000, 0.04, 'square', 0.08);
        break;
    }
  }

  private startBeam(): void {
    if (!this.ctx || !this.bus || this.beamOsc) return;
    this.beamOsc = this.ctx.createOscillator();
    this.beamGain = this.ctx.createGain();
    this.beamOsc.type = 'sawtooth';
    this.beamOsc.frequency.value = 110;
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 18;
    lfoGain.gain.value = 12;
    lfo.connect(lfoGain).connect(this.beamOsc.frequency);
    lfo.start();
    this.beamGain.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    this.beamGain.gain.exponentialRampToValueAtTime(0.12, this.ctx.currentTime + 0.05);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    this.beamOsc.connect(f).connect(this.beamGain).connect(this.bus);
    this.beamOsc.start();
  }

  private stopBeam(): void {
    if (!this.ctx || !this.beamOsc || !this.beamGain) return;
    const o = this.beamOsc;
    const g = this.beamGain;
    g.gain.cancelScheduledValues(this.ctx.currentTime);
    g.gain.setValueAtTime(g.gain.value, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.08);
    o.stop(this.ctx.currentTime + 0.1);
    this.beamOsc = null;
    this.beamGain = null;
  }

  destroy(): void {
    this.stopBeam();
    void this.ctx?.close();
    this.ctx = null;
  }
}
