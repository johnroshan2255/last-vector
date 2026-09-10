import type { PlayerInput } from '@shared/types';
import { BOMB_ORDER } from '@shared/weapons';
import type { TouchState } from '../../ui/MobileControls';

/**
 * Unifies keyboard + mouse (desktop) and the virtual sticks (mobile) into one
 * PlayerInput per tick. `override` lets the check harness inject input.
 */
export class InputSystem {
  private seq = 0;
  private keys = new Set<string>();
  private mouse = { x: 0, y: 0, left: false, right: false }; // virtual-canvas px
  private bombQueued = false;
  private bombHeld = false; // edge detection: one throw per press, even if held
  private takeQueued = false;
  private takeHeld = false;
  private pauseQueued = false;
  private debugToggle = false;
  private lagCycle = false;
  private zoomToggle = false;
  private weapon = 0; // active slot 0|1
  private bombType = 0;
  /** indices into BOMB_ORDER the current map allows; cycling stays inside this list */
  private bombKit: number[] = BOMB_ORDER.map((_, i) => i);
  /** how many of each type the player carries (cycling skips empty types) */
  private bombCounts: number[] = BOMB_ORDER.map(() => 99);
  private wheelAcc = 0;
  private lastSwapAt = 0;
  private touch: TouchState | null = null;
  private lastAim = 0;
  private lastAimAt = 0;
  private lastMoveDir: 1 | -1 = 1;
  override: Partial<Omit<PlayerInput, 'seq'>> | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly cssToVirtual: (x: number, y: number) => { x: number; y: number },
  ) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    canvas.addEventListener('pointermove', this.onPointer);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouse.left = this.mouse.right = false;
    });
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    this.keys.add(e.code);
    if (e.code === 'KeyE' || e.code === 'ShiftLeft') this.bombQueued = true;
    if (e.code === 'KeyG') this.takeQueued = true; // pick up the crate you stand next to
    if (e.code === 'KeyQ' || e.code === 'Tab') {
      e.preventDefault();
      this.cycleWeapon(1);
    }
    if (e.code === 'KeyB' || e.code === 'KeyC') this.cycleBomb();
    if (e.code === 'Escape' || e.code === 'KeyP') this.pauseQueued = true;
    if (e.code === 'F3') {
      e.preventDefault();
      this.debugToggle = true;
    }
    if (e.code === 'F4') {
      e.preventDefault();
      this.lagCycle = true;
    }
    if (e.code === 'KeyZ' || e.code === 'Minus' || e.code === 'Equal' || e.code === 'NumpadSubtract' || e.code === 'NumpadAdd') this.zoomToggle = true;
    if (e.code === 'Digit1') this.weapon = 0;
    if (e.code === 'Digit2') this.weapon = 1;
    if (e.code === 'Space') e.preventDefault();
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onPointer = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return; // touch aims via the virtual stick
    const r = this.canvas.getBoundingClientRect();
    const v = this.cssToVirtual(e.clientX - r.left, e.clientY - r.top);
    this.mouse.x = v.x;
    this.mouse.y = v.y;
  };
  private onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    this.onPointer(e);
    if (e.button === 0) this.mouse.left = true;
    if (e.button === 1) {
      e.preventDefault();
      this.zoomToggle = true; // middle click: scope zoom
    }
    if (e.button === 2) {
      this.mouse.right = true;
      this.bombQueued = true;
    }
  };
  private onPointerUp = (e: PointerEvent) => {
    if (e.button === 0) this.mouse.left = false;
    if (e.button === 2) this.mouse.right = false;
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    // trackpads emit dozens of tiny deltas per flick: accumulate to one notch and rate-limit
    this.wheelAcc += e.deltaY;
    if (Math.abs(this.wheelAcc) < 40) return;
    this.wheelAcc = 0;
    this.cycleWeapon(1);
  };

  /** toggle slot 0 <-> 1, at most once per 150 ms (a wheel notch / button tap = one swap) */
  cycleWeapon(delta: number): void {
    void delta;
    const now = performance.now();
    if (now - this.lastSwapAt < 150) return;
    this.lastSwapAt = now;
    this.weapon = this.weapon ? 0 : 1;
  }

  /** next bomb type within the map's kit that we actually have (stays put if nothing else is left) */
  cycleBomb(): void {
    const kit = this.bombKit.length ? this.bombKit : BOMB_ORDER.map((_, i) => i);
    const i = kit.indexOf(this.bombType);
    for (let step = 1; step <= kit.length; step++) {
      const cand = kit[(i + step) % kit.length];
      if ((this.bombCounts[cand] ?? 0) > 0 || cand === this.bombType) {
        this.bombType = cand;
        return;
      }
    }
  }

  /** pick a bomb type directly (HUD click / mobile button); refused if not in the kit or empty (unless forced by a pickup) */
  setBombType(index: number, force = false): boolean {
    if (!this.bombKit.includes(index)) return false;
    if (!force && (this.bombCounts[index] ?? 0) <= 0) return false;
    this.bombType = index;
    return true;
  }

  /** the sim tells us how many of each type we carry */
  setBombCounts(counts: number[]): void {
    this.bombCounts = counts;
  }

  /** the map's carried bombs (indices into BOMB_ORDER); selection resets to the first */
  setBombKit(kit: number[]): void {
    this.bombKit = kit.length ? [...kit] : BOMB_ORDER.map((_, i) => i);
    if (!this.bombKit.includes(this.bombType)) this.bombType = this.bombKit[0];
  }

  /** the sim tells us which weapon is actually selected (locked ones are refused) */
  confirmWeapon(index: number): void {
    this.weapon = index;
  }

  /** mobile controls feed here */
  setTouch(t: TouchState | null): void {
    if (t?.bomb) this.bombQueued = true;
    if (t?.swap) this.cycleWeapon(1);
    if (t?.bombType) this.cycleBomb();
    if (t?.pause) this.pauseQueued = true;
    if (t?.zoom) this.zoomToggle = true;
    this.touch = t;
  }

  takeDebugToggle(): boolean {
    const v = this.debugToggle;
    this.debugToggle = false;
    return v;
  }

  /** TAKE button (HUD) / G: pick up the crate within reach */
  queueTake(): void {
    this.takeQueued = true;
  }

  /** consume a scope-zoom request (Z / + / - / middle click / ZOOM button) */
  takeZoomToggle(): boolean {
    const v = this.zoomToggle;
    this.zoomToggle = false;
    return v;
  }

  takeLagCycle(): boolean {
    const v = this.lagCycle;
    this.lagCycle = false;
    return v;
  }

  /** consume a pause request (Esc / P / mobile button) */
  takePause(): boolean {
    const p = this.pauseQueued;
    this.pauseQueued = false;
    return p;
  }

  /**
   * @param playerScreen player position in virtual-canvas px (for mouse aim)
   * @param forced ignore the devices and send this instead (paused online, dead, lobby); seq still advances
   */
  sample(playerScreen: { x: number; y: number }, forced?: PlayerInput): PlayerInput {
    if (forced) {
      this.bombQueued = false;
      this.bombHeld = false;
      this.takeQueued = false;
      this.takeHeld = false;
      return { ...forced, seq: this.seq++ };
    }
    const k = this.keys;
    let moveX: -1 | 0 | 1 = 0;
    if (k.has('ArrowLeft') || k.has('KeyA')) moveX = -1;
    if (k.has('ArrowRight') || k.has('KeyD')) moveX = moveX === -1 ? 0 : 1;
    let jet = k.has('Space') || k.has('KeyW') || k.has('ArrowUp');
    let fire = this.mouse.left;
    let aimAngle = Math.atan2(this.mouse.y - playerScreen.y, this.mouse.x - playerScreen.x);

    const t = this.touch;
    if (t) {
      if (t.moveX) {
        moveX = t.moveX;
        this.lastMoveDir = t.moveX;
      }
      jet = jet || t.jet;
      fire = fire || t.fire;
      if (t.aimAngle !== null) {
        this.lastAim = t.aimAngle;
        this.lastAimAt = performance.now();
      }
      // aim stick idle for a while: aim where the player is heading (slight upward lob for throws)
      aimAngle = performance.now() - this.lastAimAt < 1500 ? this.lastAim : this.lastMoveDir > 0 ? -0.35 : Math.PI + 0.35;
    }

    const input: PlayerInput = {
      seq: this.seq++,
      moveX,
      jet,
      fire,
      bomb: this.bombQueued,
      take: this.takeQueued,
      aimAngle,
      weapon: this.weapon,
      bombType: this.bombType,
    };
    this.bombQueued = false;
    this.takeQueued = false;
    if (this.override) Object.assign(input, this.override);
    // rising edge only: holding bomb / take (injected input) must not spam
    const bombRaw = input.bomb;
    input.bomb = bombRaw && !this.bombHeld;
    this.bombHeld = bombRaw;
    const takeRaw = input.take;
    input.take = takeRaw && !this.takeHeld;
    this.takeHeld = takeRaw;
    return input;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.canvas.removeEventListener('pointermove', this.onPointer);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('pointerup', this.onPointerUp);
  }
}
