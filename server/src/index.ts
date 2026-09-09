import 'dotenv/config';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { monitor } from '@colyseus/monitor';
import { ROOM_NAME, GAME_NAME } from '../../shared/src/constants.js';
import { ArenaRoom } from './rooms/ArenaRoom.js';

const PORT = Number(process.env.PORT ?? 2567);

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true, game: GAME_NAME }));

// Colyseus monitor dashboard — lock this down behind auth before production.
if (process.env.NODE_ENV !== 'production') {
  app.use('/colyseus', monitor());
}

const httpServer = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define(ROOM_NAME, ArenaRoom).filterBy(['biome']);

gameServer.listen(PORT).then(() => {
  console.log(`[${GAME_NAME}] server listening on ws://localhost:${PORT}`);
});
