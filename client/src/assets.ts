/** Sprite + audio manifest. Paths are relative to /public. */
export const SPRITES = {
  player: 'assets/sprites/player.png',
  alien: 'assets/sprites/alien.png',
  bullet: 'assets/sprites/bullet.png',
  gelBomb: 'assets/sprites/gel-bomb.png',
} as const;

export const AUDIO = {
  shoot: ['assets/audio/shoot.webm', 'assets/audio/shoot.mp3'],
  explode: ['assets/audio/explode.webm', 'assets/audio/explode.mp3'],
} as const;
