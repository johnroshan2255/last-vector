export type SfxName =
  | 'shot'
  | 'shotgun'
  | 'vulcan'
  | 'arc'
  | 'rocket'
  | 'explosion'
  | 'overheat'
  | 'beamOn'
  | 'beamOff'
  | 'tile'
  | 'pickup'
  | 'fuel'
  | 'hurt'
  | 'alienHit'
  | 'alienDie'
  | 'wave'
  | 'unlock'
  | 'death'
  | 'flame'
  | 'rail'
  | 'regrow'
  | 'crate'
  | 'weaponPickup'
  | 'mineArm'
  | 'smoke'
  | 'ui';

/**
 * Tiny procedural SFX synth on WebAudio. No files to load, works offline and
 * inside the CrazyGames sandbox. Music (howler) can be layered later.
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private beamOsc: OscillatorNode | null = null;
  private beamGain: GainNode | null = null;
  private lastPlay = new Map<SfxName, number>();
  muted = false;

  /** Call from a user gesture (click/touch/key) — browsers require it. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, delay = 0): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, vol: number, lowpass = 1200): void {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime;
    const buf = this.ctx.createBuffer(1, Math.ceil(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lowpass;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
  }

  play(name: SfxName): void {
    if (!this.ctx || this.muted) return;
    // rate-limit spammy sounds
    const now = performance.now();
    const minGap = name === 'vulcan' ? 45 : name === 'tile' ? 60 : name === 'alienHit' ? 50 : name === 'flame' ? 70 : name === 'regrow' ? 120 : 0;
    if (minGap && now - (this.lastPlay.get(name) ?? 0) < minGap) return;
    this.lastPlay.set(name, now);

    switch (name) {
      case 'shot':
        this.tone(900, 0.08, 'square', 0.18, 300);
        break;
      case 'vulcan':
        this.tone(700 + Math.random() * 200, 0.05, 'square', 0.12, 250);
        break;
      case 'shotgun':
        this.noise(0.18, 0.5, 900);
        this.tone(160, 0.14, 'sawtooth', 0.25, 60);
        break;
      case 'arc':
        this.noise(0.08, 0.3, 4000);
        this.tone(1800 + Math.random() * 600, 0.07, 'sawtooth', 0.12, 400);
        break;
      case 'rocket':
        this.noise(0.25, 0.3, 600);
        this.tone(220, 0.25, 'sawtooth', 0.2, 90);
        break;
      case 'explosion':
        this.noise(0.5, 0.8, 500);
        this.tone(90, 0.4, 'sine', 0.5, 30);
        break;
      case 'overheat':
        this.tone(400, 0.25, 'square', 0.15, 120);
        this.noise(0.3, 0.2, 800);
        break;
      case 'beamOn':
        this.startBeam();
        break;
      case 'beamOff':
        this.stopBeam();
        break;
      case 'tile':
        this.noise(0.06, 0.15, 700);
        break;
      case 'pickup':
        this.tone(880, 0.06, 'square', 0.12);
        this.tone(1320, 0.08, 'square', 0.12, undefined, 0.05);
        break;
      case 'fuel':
        this.tone(520, 0.08, 'triangle', 0.15);
        this.tone(780, 0.12, 'triangle', 0.15, undefined, 0.07);
        break;
      case 'hurt':
        this.tone(200, 0.2, 'sawtooth', 0.3, 80);
        this.noise(0.12, 0.3, 1500);
        break;
      case 'alienHit':
        this.tone(300 + Math.random() * 100, 0.05, 'square', 0.08, 150);
        break;
      case 'alienDie':
        this.noise(0.2, 0.3, 900);
        this.tone(500, 0.2, 'sawtooth', 0.15, 80);
        break;
      case 'wave':
        this.tone(330, 0.15, 'square', 0.15);
        this.tone(440, 0.15, 'square', 0.15, undefined, 0.15);
        this.tone(660, 0.3, 'square', 0.15, undefined, 0.3);
        break;
      case 'unlock':
        this.tone(660, 0.1, 'triangle', 0.15);
        this.tone(880, 0.1, 'triangle', 0.15, undefined, 0.1);
        this.tone(1320, 0.25, 'triangle', 0.15, undefined, 0.2);
        break;
      case 'death':
        this.tone(300, 0.8, 'sawtooth', 0.3, 40);
        this.noise(0.8, 0.4, 400);
        break;
      case 'flame':
        this.noise(0.12, 0.18, 1400);
        break;
      case 'rail':
        this.tone(1400, 0.25, 'sawtooth', 0.25, 200);
        this.noise(0.2, 0.4, 3000);
        break;
      case 'regrow':
        this.tone(140, 0.12, 'triangle', 0.08, 260);
        break;
      case 'crate':
        this.tone(300, 0.12, 'square', 0.12, 240);
        break;
      case 'weaponPickup':
        this.tone(520, 0.08, 'square', 0.15);
        this.tone(780, 0.08, 'square', 0.15, undefined, 0.08);
        this.tone(1040, 0.16, 'square', 0.15, undefined, 0.16);
        break;
      case 'mineArm':
        this.tone(1200, 0.06, 'square', 0.1);
        break;
      case 'smoke':
        this.noise(0.6, 0.35, 600);
        break;
      case 'ui':
        this.tone(1000, 0.04, 'square', 0.08);
        break;
    }
  }

  private startBeam(): void {
    if (!this.ctx || !this.master || this.beamOsc) return;
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
    this.beamOsc.connect(f).connect(this.beamGain).connect(this.master);
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
