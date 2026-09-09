/** Rapier collision groups: (memberships << 16) | filter. */
export const G_TILE = 0x0001;
export const G_PLAYER = 0x0002;
export const G_ALIEN = 0x0004;
export const G_BOMB = 0x0008;
export const G_ALL = 0xffff;

export const groups = (member: number, filter: number): number => (((member & 0xffff) << 16) | (filter & 0xffff)) >>> 0;

export const COL_TILE = groups(G_TILE, G_ALL);
export const COL_PLAYER = groups(G_PLAYER, G_TILE | G_ALIEN | G_BOMB);
export const COL_ALIEN = groups(G_ALIEN, G_ALL);
export const COL_BOMB = groups(G_BOMB, G_TILE | G_ALIEN);

/** weapon rays hit rock and aliens, never players */
export const RAY_WEAPON = groups(G_ALL, G_TILE | G_ALIEN);
/** ground probes only see rock */
export const RAY_TILE = groups(G_ALL, G_TILE);
