// LAST-VECTOR — gun pixel art + held-gun geometry. Shared so the sim fires every round from the
// exact pixel where the drawn barrel ends (client draws the art, sim uses the muzzle maths).

import type { WeaponId } from './weapons.js';

/**
 * One gun, drawn pointing right. Legend (palette below): '#' dark metal, '=' metal, '-' highlight,
 * 'c' the weapon's colour, 'w' its core colour, 'g' grip, 'b'/'B' wood, 'o'/'O'/'l' olive,
 * 'r' red, 'y' brass, 's' glass, 'k' black.
 */
export interface GunArt {
  rows: string[];
  /** the pixel the glove holds (x, y) */
  grip: [number, number];
  /** where rounds leave the barrel: the pixel just past the tip (x, y) */
  muzzle: [number, number];
}

export const GUN_PALETTE: Record<string, number> = {
  '#': 0x2a2f3d,
  '=': 0x46586b,
  '-': 0x7a8ba0,
  g: 0x5c4a3d,
  b: 0x9a6538,
  B: 0x62401f,
  o: 0x5f6e38,
  O: 0x3b4524,
  l: 0x83944e,
  r: 0xd8402a,
  y: 0xe0b44a,
  s: 0x9ff0ff,
  k: 0x14161c,
};

/** Every gun has its own size and silhouette: a pistol is tiny, the launcher is a shoulder tube. */
export const GUN_ART: Record<WeaponId, GunArt> = {
  // compact energy pistol
  blaster: {
    rows: ['...........', '.########c.', '.=======-cw', '..#gg......', '...gg......'],
    grip: [3, 3],
    muzzle: [11, 2],
  },
  // mining beam: fat emitter lens
  vector: {
    rows: ['......###......', '..=######ccccw.', '.==###ss#ccccww', '..=######ccccw.', '....g###.......', '....gg.........', '...............'],
    grip: [4, 4],
    muzzle: [15, 2],
  },
  // pump shotgun: wooden stock and pump
  scatter: {
    rows: ['...................', 'BB.###############.', 'bbb=====#bbbb====##', '.bbb###g##BBBB#####', '......gg...........', '......g............'],
    grip: [6, 4],
    muzzle: [19, 2],
  },
  // minigun: ammo drum + a bundle of barrels
  vulcan: {
    rows: [
      '....yy...............',
      '..#######-----------.',
      '.##ccc##=###########-',
      '.#cwc##==============',
      '.##ccc##=###########-',
      '..#######-----------.',
      '....ggg#.............',
      '.....gg..............',
    ],
    grip: [5, 6],
    muzzle: [21, 3],
  },
  // SMG with glowing plasma coils
  plasma: {
    rows: ['....cccc......', '.######cwc###.', '.=====#cwc#==w', '..###g#cccc...', '....gg.#......', '....g.........'],
    grip: [4, 4],
    muzzle: [14, 2],
  },
  // flamethrower: red fuel tank, brass nozzle
  flamer: {
    rows: [
      '.rrr...............',
      'rrrrr..............',
      'rrrrr##########....',
      'rwrrr#=========#yy-',
      'rrrrr##########yyc.',
      '.rrr...g##.........',
      '.......gg..........',
      '...................',
    ],
    grip: [7, 5],
    muzzle: [19, 3],
  },
  // long scoped rifle with a bipod
  sniper: {
    rows: [
      '......#sss#...............',
      '......#####...............',
      'BBBB####==######=========-',
      'bbbbbb#g##bbbb#...........',
      '..bb...gg...#.#...........',
      '.......g......#.#.........',
      '..........................',
    ],
    grip: [7, 4],
    muzzle: [26, 2],
  },
  // tesla gun: coil prongs
  arc: {
    rows: [
      '..........c...c..',
      '..........c...c..',
      '.=#######c#c#c#c.',
      '.==####sswcwcwcww',
      '.=#######c#c#c#c.',
      '....g##...c...c..',
      '....gg...........',
      '.................',
    ],
    grip: [4, 5],
    muzzle: [17, 3],
  },
  // railgun: long rail with charge coils
  rail: {
    rows: ['........................', '.#####c#c#c#c#c######...', '=====###########======cw', '.#####c#c#c#c#c######...', '...g##..................', '...gg...................'],
    grip: [3, 4],
    muzzle: [24, 2],
  },
  // rocket launcher: a big olive shoulder tube with a red warhead in the mouth
  launcher: {
    rows: [
      '..............................',
      '..OOOOOOOOOOOOOOOOOOOOOOO.....',
      '.OllllllllllllllllllllllOrrr..',
      'kOoooooooo#ooooooooooooOrrrryy',
      '.OoooooooooooooooooooooooorrrO',
      '..OOOOOOOOOOOOOOOOOOOOOOO.....',
      '..........g##....#g...........',
      '..........gg......g...........',
      '..............................',
    ],
    grip: [10, 6],
    muzzle: [30, 3],
  },
  // EMP: a charged orb sitting in a dish
  emp: {
    rows: ['.........ccc.....', '........cwwwc....', '.#######cwwwc##..', '.==####==#ccc###c', '.#######cwwwc##..', '....g##.cwwwc....', '....gg...ccc.....', '.................', '.................'],
    grip: [4, 5],
    muzzle: [17, 3],
  },
};

/** pixels per unit (tile), and where the arm holds the gun */
const PX = 16;
/** the shoulder pivot sits this many px above the body centre */
export const SHOULDER_Y_PX = -1;
/** the glove (end of the arm) holds the grip this many px out from the shoulder */
export const GLOVE_PX = 8;

/** the muzzle relative to the shoulder, in px, before rotation (x along the aim, y down the art) */
export function muzzleLocalPx(id: WeaponId): { x: number; y: number } {
  const a = GUN_ART[id];
  return { x: GLOVE_PX + a.muzzle[0] - (a.grip[0] + 0.5), y: a.muzzle[1] - a.grip[1] };
}

/**
 * World position (units) of the muzzle of `id` held by a pilot at (x, y) aiming at `aim`.
 * The art is mirrored vertically when aiming left (the gun stays upright), same as the view.
 */
export function muzzlePoint(x: number, y: number, aim: number, id: WeaponId): { x: number; y: number } {
  const m = muzzleLocalPx(id);
  const flip = Math.cos(aim) < 0 ? -1 : 1;
  const c = Math.cos(aim);
  const s = Math.sin(aim);
  const ly = m.y * flip;
  return { x: x + (m.x * c - ly * s) / PX, y: y + SHOULDER_Y_PX / PX + (m.x * s + ly * c) / PX };
}

/** the shoulder pivot (units) of a pilot at (x, y) */
export function shoulderPoint(x: number, y: number): { x: number; y: number } {
  return { x, y: y + SHOULDER_Y_PX / PX };
}
