'use strict';
const crypto = require('crypto');
const Poker = require('./games/poker');
const Piramide = require('./games/piramide');
const MayorMenor = require('./games/mayormenor');

const MAX_PLAYERS = 8;
const INACTIVE_MS = 120000; // sin tocar la pantalla
const TURN_IDLE_MS = 45000; // con el turno y sin reaccionar
const VOTE_MS = 30000;
const KICK_COOLDOWN_MS = 30000;
const EMPTY_ROOM_TTL_MS = 30 * 60 * 1000;
const GAME_TYPES = { poker: Poker, piramide: Piramide, mayormenor: MayorMenor };
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin I ni O para no confundir

const ok = (extra = {}) => ({ ok: true, ...extra });
const fail = (error, extra = {}) => ({ ok: false, error, ...extra });
const rand = (bytes) => crypto.randomBytes(bytes).toString('hex');
const cleanName = (n) => String(n ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);

class Room {
  constructor(code, io) {
    this.code = code;
    this.io = io;
    this.players = new Map(); // id -> jugador (la "matriz" de asientos del servidor)
    this.tokens = new Map(); // token -> id
    this.hostId = null;
    this.game = null;
    this.gameType = null;
    this.vote = null;
    this.voteTimer = null;
    this.cooldowns = new Map();
    this.logs = [];
    this.emptySince = null;
    this._queued = false;
    this._sig = '';
    this.ctx = this.makeCtx();
  }

  // Contexto que ven los motores de juego
  makeCtx() {
    const room = this;
    return {
      isConnected: (id) => !!room.players.get(id)?.connected,
      isHost: (id) => room.hostId === id,
      name: (id) => room.players.get(id)?.name || 'Alguien',
      addPending(id, n) {
        const p = room.players.get(id);
        if (p) p.pendientes = Math.max(0, p.pendientes + n);
      },
      addToGive(id, n) {
        const p = room.players.get(id);
        if (p) p.repartir = Math.max(0, p.repartir + n);
      },
      log: (t) => room.log(t),
      alert: (a) => room.io.to(room.code).emit('alert', a),
      update: () => room.queueBroadcast(),
    };
  }

  log(text) {
    this.logs.push({ t: Date.now(), text });
    if (this.logs.length > 60) this.logs.shift();
    this.queueBroadcast();
  }

  // ---------- Jugadores ----------
  freeSeat() {
    const used = new Set([...this.players.values()].map((p) => p.seat));
    for (let i = 0; i < MAX_PLAYERS; i++) if (!used.has(i)) return i;
    return -1;
  }

  join(rawName, socket) {
    const name = cleanName(rawName);
    if (!name) return fail('Escribe un nombre (1 a 16 caracteres)');
    const same = [...this.players.values()].find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (same) {
      if (same.connected) return fail('Ese nombre ya está en uso en esta sala');
      this.attach(same.id, socket, false); // recupera su asiento por nombre
      return ok({ playerId: same.id, token: same.token, resumed: true });
    }
    const seat = this.freeSeat();
    if (seat === -1) return fail('La sala está llena (máximo 8 jugadores)');
    const p = { id: 'p' + rand(4), token: rand(16), name, seat, socketId: null, connected: false, pendientes: 0, repartir: 0, joinedAt: Date.now(), lastActivity: Date.now() };
    this.players.set(p.id, p);
    this.tokens.set(p.token, p.id);
    if (!this.hostId) this.hostId = p.id;
    this.attach(p.id, socket, true);
    this.game?.addPlayer?.(p.id);
    return ok({ playerId: p.id, token: p.token, resumed: false });
  }

  resume(token, socket) {
    const id = this.tokens.get(token);
    if (!id) return fail('Tu asiento ya no existe (saliste o te expulsaron)', { fatal: true });
    this.attach(id, socket, false);
    const p = this.players.get(id);
    return ok({ playerId: id, token: p.token, resumed: true });
  }

  attach(id, socket, isNew) {
    const p = this.players.get(id);
    if (p.socketId && p.socketId !== socket.id) {
      const old = this.io.sockets.sockets.get(p.socketId);
      if (old) {
        old.emit('session:replaced');
        old.data = {};
        old.leave(this.code);
      }
    }
    p.socketId = socket.id;
    p.connected = true;
    p.lastActivity = Date.now();
    this.emptySince = null;
    socket.join(this.code);
    socket.data.roomCode = this.code;
    socket.data.playerId = id;
    this.log(isNew ? `${p.name} se unió a la mesa` : `${p.name} volvió a la mesa`);
    if (this.vote && this.vote.targetId === id) this.cancelVote(`${p.name} volvió`);
    if (!isNew) this.game?.onReconnect?.(id);
    this.queueBroadcast();
  }

  onDisconnect(socket) {
    const id = socket.data.playerId;
    const p = this.players.get(id);
    if (!p || p.socketId !== socket.id) return;
    p.connected = false;
    p.socketId = null;
    this.log(`${p.name} se desconectó (su lugar y sus tragos quedan guardados)`);
    if (this.hostId === id) this.migrateHost();
    if (this.vote) this.evaluateVote();
    if (![...this.players.values()].some((x) => x.connected)) this.emptySince = Date.now();
    this.queueBroadcast();
  }

  migrateHost() {
    const next = [...this.players.values()].filter((p) => p.connected).sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (next && next.id !== this.hostId) {
      this.hostId = next.id;
      this.log(`${next.name} es ahora el anfitrión`);
    }
  }

  touch(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.lastActivity = Date.now();
    if (this.vote && this.vote.targetId === id) this.cancelVote(`${p.name} sigue en la mesa`);
  }

  removePlayer(id, reason) {
    const p = this.players.get(id);
    if (!p) return;
    this.game?.removePlayer?.(id);
    this.players.delete(id);
    this.tokens.delete(p.token);
    if (p.socketId) {
      const sock = this.io.sockets.sockets.get(p.socketId);
      if (sock) {
        sock.emit('kicked', { reason });
        sock.leave(this.code);
        sock.data = {};
      }
    }
    if (this.vote && this.vote.targetId === id) this.clearVote();
    if (this.hostId === id) {
      this.hostId = null;
      this.migrateHost();
      if (!this.hostId) this.hostId = [...this.players.keys()][0] || null;
    }
    this.queueBroadcast();
  }

  // ---------- Juegos ----------
  startGame(pid, type, opts) {
    if (pid !== this.hostId) return fail('Solo el anfitrión puede iniciar juegos');
    const Game = GAME_TYPES[type];
    if (!Game) return fail('Juego desconocido');
    if (this.game) return fail('Ya hay un juego en curso. Termínalo primero');
    const ids = [...this.players.values()].filter((p) => p.connected).sort((a, b) => a.seat - b.seat).map((p) => p.id);
    if (ids.length < 2) return fail('Se necesitan al menos 2 jugadores conectados');
    try {
      this.game = new Game(this.ctx, ids, opts && typeof opts === 'object' ? opts : {});
      this.gameType = type;
    } catch (e) {
      this.game = null;
      this.gameType = null;
      return fail('No se pudo iniciar el juego');
    }
    const label = { poker: 'Poker de Tragos', piramide: 'La Pirámide', mayormenor: 'Mayor o Menor' }[type];
    this.log(`▶ Empieza ${label}`);
    this.queueBroadcast();
    return ok();
  }

  stopGame(pid) {
    if (pid !== this.hostId) return fail('Solo el anfitrión puede terminar el juego');
    if (!this.game) return fail('No hay juego en curso');
    this.game.destroy?.();
    this.game = null;
    this.gameType = null;
    this.log('⏹ Se terminó el juego. Los tragos acumulados se mantienen');
    this.queueBroadcast();
    return ok();
  }

  // ---------- Tragos ----------
  give(fromId, toId, amount) {
    const from = this.players.get(fromId);
    const to = this.players.get(toId);
    amount = Math.floor(Number(amount));
    if (!to || toId === fromId) return fail('Elige a otro jugador');
    if (!Number.isFinite(amount) || amount < 1) return fail('Cantidad inválida');
    if (amount > from.repartir) return fail('No tienes tantos tragos para repartir');
    from.repartir -= amount;
    to.pendientes += amount;
    this.game?.onGive?.(fromId, amount);
    this.log(`🎁 ${from.name} le reparte ${amount} ${amount === 1 ? 'trago' : 'tragos'} a ${to.name}`);
    if (to.socketId) this.io.to(to.socketId).emit('received', { from: from.name, amount });
    this.queueBroadcast();
    return ok();
  }

  drink(id, amount) {
    const p = this.players.get(id);
    amount = Math.floor(Number(amount));
    if (!Number.isFinite(amount) || amount < 1) return fail('Cantidad inválida');
    amount = Math.min(amount, p.pendientes);
    if (amount < 1) return fail('No tienes tragos por tomar');
    p.pendientes -= amount;
    this.log(`🍺 ${p.name} tomó ${amount} ${amount === 1 ? 'trago' : 'tragos'}`);
    this.queueBroadcast();
    return ok();
  }

  // ---------- Votación para expulsar ----------
  statusOf(p, now, actor) {
    if (!p.connected) return 'offline';
    if (now - p.lastActivity > INACTIVE_MS) return 'idle';
    if (actor && actor.id === p.id && now - Math.max(actor.since, p.lastActivity) > TURN_IDLE_MS) return 'idle';
    return 'online';
  }

  startKick(byId, targetId) {
    const target = this.players.get(targetId);
    const by = this.players.get(byId);
    if (!target || targetId === byId) return fail('Jugador no válido');
    if (this.vote) return fail('Ya hay una votación en curso');
    const status = this.statusOf(target, Date.now(), this.game?.currentActor?.());
    if (status === 'online') return fail('Solo puedes expulsar a quien está desconectado o inactivo');
    const cd = this.cooldowns.get(targetId);
    if (cd && cd > Date.now()) return fail('Espera un momento antes de volver a votar por esta persona');
    this.vote = { id: rand(4), targetId, targetName: target.name, initiatorId: byId, initiatorName: by.name, yes: new Set([byId]), no: new Set(), expiresAt: Date.now() + VOTE_MS };
    this.voteTimer = setTimeout(() => this.evaluateVote(true), VOTE_MS);
    this.log(`🗳 ${by.name} propone expulsar a ${target.name}`);
    this.evaluateVote();
    this.queueBroadcast();
    return ok();
  }

  eligibleVoters() {
    if (!this.vote) return [];
    return [...this.players.values()].filter((p) => p.connected && p.id !== this.vote.targetId);
  }

  castVote(pid, voteId, accept) {
    const v = this.vote;
    if (!v || v.id !== voteId) return fail('Esa votación ya terminó');
    if (pid === v.targetId) return fail('No puedes votar tu propia expulsión');
    v.yes.delete(pid);
    v.no.delete(pid);
    (accept ? v.yes : v.no).add(pid);
    this.evaluateVote();
    this.queueBroadcast();
    return ok();
  }

  evaluateVote(final = false) {
    const v = this.vote;
    if (!v) return;
    const ids = new Set(this.eligibleVoters().map((p) => p.id));
    const yes = [...v.yes].filter((id) => ids.has(id)).length;
    const no = [...v.no].filter((id) => ids.has(id)).length;
    const n = ids.size;
    if (yes * 2 > n) {
      const name = v.targetName;
      const targetId = v.targetId;
      this.clearVote();
      this.log(`🚪 La mesa votó: ${name} fue expulsado y su asiento quedó libre`);
      this.removePlayer(targetId, 'kick');
    } else if (no * 2 >= n || final) {
      this.cooldowns.set(v.targetId, Date.now() + KICK_COOLDOWN_MS);
      this.clearVote();
      this.log(`La votación para expulsar a ${v.targetName} no alcanzó mayoría`);
    }
  }

  cancelVote(why) {
    if (!this.vote) return;
    this.clearVote();
    this.log(`Votación cancelada: ${why}`);
  }

  clearVote() {
    clearTimeout(this.voteTimer);
    this.voteTimer = null;
    this.vote = null;
    this.queueBroadcast();
  }

  voteView(forId) {
    const v = this.vote;
    if (!v) return null;
    const ids = new Set(this.eligibleVoters().map((p) => p.id));
    return {
      id: v.id,
      targetId: v.targetId,
      targetName: v.targetName,
      initiatorName: v.initiatorName,
      yes: [...v.yes].filter((id) => ids.has(id)).length,
      no: [...v.no].filter((id) => ids.has(id)).length,
      eligible: ids.size,
      needed: Math.floor(ids.size / 2) + 1,
      expiresAt: v.expiresAt,
      canVote: ids.has(forId),
      myVote: v.yes.has(forId) ? true : v.no.has(forId) ? false : null,
    };
  }

  // ---------- Difusión de estado ----------
  playersView(now) {
    const actor = this.game?.currentActor?.();
    return [...this.players.values()]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => {
        const status = this.statusOf(p, now, actor);
        return {
          id: p.id,
          name: p.name,
          seat: p.seat,
          status,
          connected: p.connected,
          kickable: status !== 'online',
          pendientes: p.pendientes,
          repartir: p.repartir,
          isHost: p.id === this.hostId,
          inGame: this.game ? !!this.game.has?.(p.id) : false,
        };
      });
  }

  stateFor(id, now = Date.now(), players = this.playersView(now)) {
    return {
      room: {
        code: this.code,
        you: id,
        hostId: this.hostId,
        gameType: this.gameType,
        players,
        vote: this.voteView(id),
        log: this.logs.slice(-40),
        serverTime: now,
        maxPlayers: MAX_PLAYERS,
      },
      game: this.game ? this.game.view(id) : null,
    };
  }

  queueBroadcast() {
    if (this._queued) return;
    this._queued = true;
    setImmediate(() => {
      this._queued = false;
      this.broadcast();
    });
  }

  broadcast() {
    const now = Date.now();
    const players = this.playersView(now);
    this._sig = players.map((p) => p.id + p.status).join('|');
    for (const p of this.players.values()) {
      if (p.connected && p.socketId) this.io.to(p.socketId).emit('state', this.stateFor(p.id, now, players));
    }
  }

  tick() {
    const now = Date.now();
    const sig = this.playersView(now).map((p) => p.id + p.status).join('|');
    if (sig !== this._sig) this.queueBroadcast();
  }

  destroy() {
    this.game?.destroy?.();
    clearTimeout(this.voteTimer);
  }
}

class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.timer = setInterval(() => this.sweep(), 5000);
    this.timer.unref?.();
  }
  create() {
    let code;
    do {
      code = Array.from({ length: 4 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(code));
    const room = new Room(code, this.io);
    this.rooms.set(code, room);
    return room;
  }
  get(code) {
    return this.rooms.get(String(code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4));
  }
  sweep() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      room.tick();
      if (room.emptySince && now - room.emptySince > EMPTY_ROOM_TTL_MS) {
        room.destroy();
        this.rooms.delete(code);
      }
    }
  }
  close() {
    clearInterval(this.timer);
    for (const room of this.rooms.values()) room.destroy();
  }
}

module.exports = { Room, RoomManager, cleanName, MAX_PLAYERS };
