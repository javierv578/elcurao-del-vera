'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const { RoomManager, cleanName } = require('./rooms');

/**
 * Crea el servidor HTTP + Socket.io.
 * ALLOWED_ORIGINS: orígenes permitidos separados por coma (ej. https://usuario.github.io).
 * Si no se define, se permite cualquier origen (útil solo en desarrollo).
 */
function createServer({ allowedOrigins = parseOrigins(process.env.ALLOWED_ORIGINS) } = {}) {
  const originCheck = allowedOrigins.length ? allowedOrigins : true;
  const app = express();
  app.use(cors({ origin: originCheck }));

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: originCheck, methods: ['GET', 'POST'] },
    pingInterval: 10000,
    pingTimeout: 15000,
  });
  const rooms = new RoomManager(io);

  app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.rooms.size }));

  // Conveniencia en desarrollo: sirve el frontend de ../docs en el mismo puerto
  const docs = path.join(__dirname, '..', 'docs');
  if (process.env.SERVE_STATIC !== '0' && fs.existsSync(docs)) app.use(express.static(docs));

  io.on('connection', (socket) => {
    // Límite simple de mensajes por segundo
    let count = 0;
    const iv = setInterval(() => (count = 0), 1000);
    socket.on('disconnect', () => clearInterval(iv));
    socket.use((_packet, next) => (++count > 60 ? next(new Error('rate limit')) : next()));

    const reply = (ack) => (typeof ack === 'function' ? ack : () => {});
    const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    const me = () => {
      const room = rooms.rooms.get(socket.data.roomCode);
      const player = room?.players.get(socket.data.playerId);
      if (!room || !player || player.socketId !== socket.id) return null;
      return { room, player };
    };
    const withMe = (ack, fn) => {
      const r = me();
      if (!r) return reply(ack)({ ok: false, error: 'No estás en una sala', fatal: true });
      r.room.touch(r.player.id);
      return reply(ack)(fn(r.room, r.player));
    };

    socket.on('room:create', (msg, ack) => {
      if (socket.data.roomCode) return reply(ack)({ ok: false, error: 'Ya estás en una sala' });
      if (!cleanName(msg?.name)) return reply(ack)({ ok: false, error: 'Escribe un nombre (1 a 16 caracteres)' });
      const room = rooms.create();
      const res = room.join(msg.name, socket);
      reply(ack)({ ...res, code: room.code });
    });

    socket.on('room:join', (msg, ack) => {
      if (socket.data.roomCode) return reply(ack)({ ok: false, error: 'Ya estás en una sala' });
      const room = rooms.get(msg?.code);
      if (!room) return reply(ack)({ ok: false, error: 'No encontramos esa sala. Revisa el código' });
      const res = msg.token && room.tokens.has(msg.token) ? room.resume(msg.token, socket) : room.join(msg.name, socket);
      reply(ack)({ ...res, code: room.code });
    });

    socket.on('session:resume', (msg, ack) => {
      if (socket.data.roomCode) return reply(ack)({ ok: false, error: 'Ya estás en una sala' });
      const room = rooms.get(msg?.code);
      if (!room) return reply(ack)({ ok: false, error: 'La sala ya no existe', fatal: true });
      reply(ack)({ ...room.resume(String(msg.token || ''), socket), code: room.code });
    });

    socket.on('room:leave', (_msg, ack) => {
      const r = me();
      if (r) r.room.removePlayer(r.player.id, 'leave');
      socket.data = {};
      reply(ack)({ ok: true });
    });

    socket.on('activity', () => {
      const r = me();
      if (r) r.room.touch(r.player.id);
    });

    socket.on('game:start', (msg, ack) => withMe(ack, (room, p) => room.startGame(p.id, msg?.type, msg?.options)));
    socket.on('game:stop', (_msg, ack) => withMe(ack, (room, p) => room.stopGame(p.id)));
    socket.on('game:action', (msg, ack) =>
      withMe(ack, (room, p) => {
        if (!room.game) return { ok: false, error: 'No hay un juego en curso' };
        const res = room.game.handle(p.id, String(msg?.action || ''), msg?.payload && typeof msg.payload === 'object' ? msg.payload : {});
        room.queueBroadcast();
        return res;
      })
    );

    socket.on('drinks:give', (msg, ack) => withMe(ack, (room, p) => room.give(p.id, String(msg?.to || ''), msg?.amount)));
    socket.on('drinks:drink', (msg, ack) => withMe(ack, (room, p) => room.drink(p.id, msg?.amount)));

    socket.on('kick:start', (msg, ack) => withMe(ack, (room, p) => room.startKick(p.id, String(msg?.target || ''))));
    socket.on('kick:vote', (msg, ack) => withMe(ack, (room, p) => room.castVote(p.id, String(msg?.voteId || ''), !!msg?.accept)));

    socket.on('disconnect', () => {
      const room = rooms.rooms.get(socket.data.roomCode);
      if (room) room.onDisconnect(socket);
    });
  });

  return { app, server, io, rooms };
}

function parseOrigins(v) {
  if (!v || v.trim() === '*') return [];
  return v.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
}

if (require.main === module) {
  const { server } = createServer();
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => console.log(`El Curao del Vera escuchando en el puerto ${port}`));
}

module.exports = { createServer };
