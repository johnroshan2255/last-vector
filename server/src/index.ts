import 'dotenv/config';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server, matchMaker } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { monitor } from '@colyseus/monitor';
import { ROOM_NAME, GAME_NAME, ROOM_CODE_LENGTH, MAX_PLAYERS_PER_ROOM } from '../../shared/src/constants.js';
import type { RoomLookup } from '../../shared/src/types.js';
import { ArenaRoom } from './rooms/ArenaRoom.js';

const PORT = Number(process.env.PORT ?? 2567);

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true, game: GAME_NAME, maxPlayers: MAX_PLAYERS_PER_ROOM }));

/**
 * Room-code lookup for "JOIN WITH CODE". Hosted rooms are private (quick play
 * never lands in them), so the client resolves the code here and then joins by
 * room id. 404 = no such room, 409 = full.
 */
app.get('/rooms/:code', async (req, res) => {
  const code = String(req.params.code ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_CODE_LENGTH);
  if (code.length !== ROOM_CODE_LENGTH) return res.status(400).json({ error: 'BAD_CODE' });
  const rooms = await matchMaker.query({ name: ROOM_NAME });
  const room = rooms.find((r) => r.metadata?.code === code);
  if (!room) return res.status(404).json({ error: 'NOT_FOUND' });
  const info: RoomLookup = {
    roomId: room.roomId,
    code,
    clients: room.clients,
    maxClients: room.maxClients,
    started: !!room.metadata?.started,
    biome: String(room.metadata?.biome ?? 'verdant'),
    map: String(room.metadata?.map ?? 'hollow'),
  };
  if (room.locked || room.clients >= room.maxClients) return res.status(409).json({ error: 'FULL', ...info });
  return res.json(info);
});

// Colyseus monitor dashboard — lock this down behind auth before production.
if (process.env.NODE_ENV !== 'production') {
  app.use('/colyseus', monitor());
}

const httpServer = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

// quick play groups public rooms by map; hosted rooms are private and found by code
gameServer.define(ROOM_NAME, ArenaRoom).filterBy(['map']);

gameServer.listen(PORT).then(() => {
  console.log(`[${GAME_NAME}] server listening on ws://localhost:${PORT}`);
});
