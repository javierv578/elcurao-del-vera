'use strict';
// Prueba de humo: 3 jugadores reales por socket contra el servidor real.
const assert = require('assert');
const { io } = require('socket.io-client');
const { createServer } = require('../server');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(url) {
  const socket = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  const c = { socket, state: null, alerts: [], received: [] };
  socket.on('state', (s) => (c.state = s));
  socket.on('alert', (a) => c.alerts.push(a));
  socket.on('received', (r) => c.received.push(r));
  c.emit = (ev, msg) => new Promise((res) => socket.emit(ev, msg, res));
  c.ready = new Promise((r) => socket.on('connect', r));
  return c;
}
const me = (c) => c.state.room.players.find((p) => p.id === c.state.room.you);

(async () => {
  const { server, rooms } = createServer({ allowedOrigins: [] });
  await new Promise((r) => server.listen(0, r));
  const url = `http://localhost:${server.address().port}`;
  const [A, B, C] = [client(url), client(url), client(url)];
  await Promise.all([A.ready, B.ready, C.ready]);

  // --- Salas ---
  const created = await A.emit('room:create', { name: 'Ana' });
  assert(created.ok && /^[A-HJ-NP-Z]{4}$/.test(created.code), 'código de 4 letras');
  const code = created.code;
  const jb = await B.emit('room:join', { code, name: 'Beto' });
  const jc = await C.emit('room:join', { code: code.toLowerCase(), name: 'Caro' });
  assert(jb.ok && jc.ok, 'se unen por código');
  assert(!(await client(url).emit('room:join', { code: 'ZZZZ', name: 'X' })).ok, 'sala inexistente falla');
  await sleep(50);
  assert.strictEqual(A.state.room.players.length, 3);
  assert(A.state.room.players.every((p) => p.pendientes === 0 && p.repartir === 0));
  console.log('✔ salas y unión por código');

  // --- Poker: privacidad + mano completa ---
  assert((await A.emit('game:start', { type: 'poker', options: { buyIn: 10 } })).ok);
  await sleep(50);
  for (const c of [A, B, C]) {
    const g = c.state.game;
    assert.strictEqual(g.type, 'poker');
    assert(g.you.hole.length === 2 && g.you.hole.every(Boolean), 've sus 2 cartas');
    for (const s of g.seats) if (s.id !== c.state.room.you) assert(s.cards.every((x) => x === null), 'no ve cartas ajenas');
    assert(!JSON.stringify(g).includes('"deck"'), 'el mazo no se envía');
  }
  console.log('✔ poker: cada jugador solo ve sus cartas');

  const byId = { [A.state.room.you]: A, [B.state.room.you]: B, [C.state.room.you]: C };
  let guard = 0;
  while (A.state.game.phase !== 'showdown' && guard++ < 60) {
    const actor = A.state.game.toAct;
    const c = byId[actor];
    const y = c.state.game.you;
    const act = y.canCheck ? 'check' : 'call';
    const r = await c.emit('game:action', { action: act });
    assert(r.ok, 'acción válida: ' + JSON.stringify(r));
    await sleep(15);
  }
  assert.strictEqual(A.state.game.phase, 'showdown');
  const net = Object.values(A.state.game.result.net);
  assert.strictEqual(net.reduce((a, b) => a + b, 0), 0, 'los tragos se conservan');
  const gained = A.state.room.players.reduce((s, p) => s + p.repartir, 0);
  assert.strictEqual(gained, net.filter((n) => n > 0).reduce((a, b) => a + b, 0), 'ganadores reciben por repartir');
  assert(A.state.game.seats.filter((s) => !s.folded).every((s) => s.cards.every(Boolean)), 'showdown revela cartas');
  console.log('✔ poker: mano completa hasta showdown, tragos conservados');

  // --- All-in -> alerta global ---
  await sleep(10200); // siguiente mano automática
  const actor = byId[A.state.game.toAct];
  assert((await actor.emit('game:action', { action: 'allin' })).ok);
  await sleep(50);
  assert(A.alerts.some((a) => a.kind === 'all_in' && /fondo/i.test(a.penalty)), 'alerta All-In con vaso lleno a fondo');
  assert(B.alerts.length && C.alerts.length, 'la alerta llega a todos');
  console.log('✔ all-in: alerta "vaso lleno a fondo" para toda la sala');

  // --- Reconexión por token ---
  const bId = B.state.room.you;
  const bToken = jb.token;
  const bHole = JSON.stringify(B.state.game.you.hole);
  B.socket.disconnect();
  await sleep(80);
  assert.strictEqual(A.state.room.players.find((p) => p.id === bId).connected, false, 'se ve desconectado');
  const B2 = client(url);
  await B2.ready;
  const rr = await B2.emit('session:resume', { code, token: bToken });
  assert(rr.ok && rr.playerId === bId, 'resume con token');
  await sleep(50);
  assert.strictEqual(JSON.stringify(B2.state.game.you.hole), bHole, 'conserva sus cartas');
  console.log('✔ reconexión: mismo asiento, mismas cartas');

  // --- Votación para expulsar ---
  const cId = C.state.room.you;
  assert(!(await A.emit('kick:start', { target: bId })).ok, 'no se puede expulsar a alguien conectado');
  C.socket.disconnect();
  await sleep(80);
  const k = await A.emit('kick:start', { target: cId });
  assert(k.ok, 'inicia votación');
  await sleep(50);
  const v = B2.state.room.vote;
  assert(v && v.targetId === cId && v.canVote, 'B puede votar');
  await B2.emit('kick:vote', { voteId: v.id, accept: true });
  await sleep(80);
  assert.strictEqual(A.state.room.players.length, 2, 'Caro fue eliminada de la matriz');
  assert(!A.state.room.players.some((p) => p.id === cId));
  assert((await client(url).emit('session:resume', { code, token: jc.token })).ok === false, 'token expulsado ya no sirve');
  console.log('✔ expulsión: mayoría elimina al jugador y libera el asiento');

  // --- Pirámide ---
  assert((await A.emit('game:stop', {})).ok);
  assert((await A.emit('game:start', { type: 'piramide', options: { rows: 4, handSize: 3 } })).ok);
  await sleep(50);
  const pg = A.state.game;
  assert.strictEqual(pg.pyramid.length, 4);
  assert(pg.pyramid.flat().every((c) => !c.revealed && c.card === null), 'pirámide boca abajo');
  assert(pg.you.hand.length === 3 && pg.players.every((p) => typeof p.count === 'number'));
  assert(!('hand' in (B2.state.game.players.find((p) => p.id === A.state.room.you) || {})), 'no ve manos ajenas');
  assert(!(await B2.emit('game:action', { action: 'reveal' })).ok, 'solo el anfitrión revela');
  let claims = 0;
  for (let i = 0; i < pg.total; i++) {
    assert((await A.emit('game:action', { action: 'reveal' })).ok);
    await sleep(15);
    for (const c of [A, B2]) {
      const r = await c.emit('game:action', { action: 'claim' });
      if (r.ok) {
        claims++;
        const mine = me(c).repartir;
        assert(mine > 0, 'recibe tragos por repartir');
        const other = c === A ? B2 : A;
        const g = await c.emit('drinks:give', { to: other.state.room.you, amount: mine });
        assert(g.ok);
        await sleep(15);
        assert(other.received.length > 0, 'el destinatario es notificado');
      }
    }
  }
  assert((await A.emit('game:action', { action: 'reveal' })).ok);
  await sleep(30);
  assert.strictEqual(A.state.game.phase, 'finished');
  assert(A.state.game.hands, 'al final se muestran las manos');
  console.log(`✔ pirámide: revelado por filas, ${claims} reclamos validados por el servidor`);

  // --- Mayor o Menor ---
  assert((await A.emit('game:stop', {})).ok);
  assert((await A.emit('game:start', { type: 'mayormenor' })).ok);
  await sleep(50);
  for (let i = 0; i < 12; i++) {
    const g = A.state.game;
    const c = g.turn === A.state.room.you ? A : B2;
    const wrongTurn = c === A ? B2 : A;
    assert(!(await wrongTurn.emit('game:action', { action: 'guess', payload: { guess: 'higher' } })).ok, 'fuera de turno falla');
    assert((await c.emit('game:action', { action: 'guess', payload: { guess: ['higher', 'lower', 'equal'][i % 3] } })).ok);
    await sleep(15);
  }
  assert.strictEqual(A.state.game.plays, 12);
  const total = A.state.room.players.reduce((s, p) => s + p.pendientes + p.repartir, 0);
  console.log(`✔ mayor o menor: 12 jugadas, turnos validados (tragos en juego: ${total})`);

  console.log('\nTodo OK');
  rooms.close();
  server.close();
  process.exit(0);
})().catch((e) => {
  console.error('✘ FALLÓ:', e);
  process.exit(1);
});
