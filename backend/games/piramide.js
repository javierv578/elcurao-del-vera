'use strict';
const { Deck } = require('./deck');

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const toInt = (v, d) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : d;
};
const ok = () => ({ ok: true });
const err = (error) => ({ ok: false, error });

const RANK_NAME = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };
const SUIT_NAME = { c: '♣', d: '♦', h: '♥', s: '♠' };
const pretty = (c) => RANK_NAME[c[0]] + SUIT_NAME[c[1]];

/**
 * La Pirámide.
 * El servidor reparte la mano privada de cada jugador y arma la pirámide boca abajo.
 * Se revela una carta a la vez, de la fila de abajo hacia la punta (la fila de abajo vale 1 trago,
 * la punta vale tantos tragos como filas). Quien tenga una carta del mismo número la reclama y
 * el servidor valida contra su mano real: obtiene (coincidencias x valor) tragos para repartir.
 * Lo que no reparta antes de la siguiente carta se pierde.
 */
class Piramide {
  constructor(ctx, playerIds, opts = {}) {
    this.ctx = ctx;
    this.type = 'piramide';
    this.rows = clamp(toInt(opts.rows, 5), 3, 6);
    const cellsTotal = (this.rows * (this.rows + 1)) / 2;
    let hs = clamp(toInt(opts.handSize, 4), 2, 5);
    while (playerIds.length * hs + cellsTotal > 52 && hs > 1) hs--;
    this.handSize = hs;

    const deck = new Deck();
    this.hands = {};
    playerIds.forEach((id) => (this.hands[id] = deck.draw(hs)));
    this.pyramid = [];
    for (let r = 0; r < this.rows; r++) {
      const row = [];
      for (let c = 0; c <= r; c++) row.push({ card: deck.draw(1)[0], revealed: false });
      this.pyramid.push(row);
    }
    // Orden de revelado: fila de abajo (más ancha) primero, de izquierda a derecha
    this.sequence = [];
    for (let r = this.rows - 1; r >= 0; r--) for (let c = 0; c <= r; c++) this.sequence.push([r, c]);
    this.pos = 0;
    this.current = null;
    this.claims = {};
    this.phase = 'playing';
  }

  has(id) {
    return Object.prototype.hasOwnProperty.call(this.hands, id);
  }
  currentActor() {
    return null;
  }
  destroy() {}
  addPlayer() {} // los que llegan tarde miran la ronda
  onReconnect() {}
  removePlayer(id) {
    delete this.hands[id];
    delete this.claims[id];
    this.ctx.update();
  }
  onGive(pid, n) {
    const c = this.claims[pid];
    if (c) c.remaining = Math.max(0, c.remaining - n);
  }

  forfeit() {
    for (const [pid, c] of Object.entries(this.claims)) {
      if (c.remaining > 0) {
        this.ctx.addToGive(pid, -c.remaining);
        this.ctx.log(`${this.ctx.name(pid)} no repartió ${c.remaining} ${c.remaining === 1 ? 'trago' : 'tragos'} a tiempo y los pierde`);
      }
    }
    this.claims = {};
  }

  handle(pid, action) {
    if (action === 'reveal') {
      if (!this.ctx.isHost(pid)) return err('Solo el anfitrión revela las cartas');
      if (this.phase !== 'playing') return err('La pirámide ya terminó');
      this.forfeit();
      if (this.pos >= this.sequence.length) {
        this.phase = 'finished';
        this.current = null;
        this.ctx.log('🏁 Se acabó la pirámide. Todos muestran sus cartas');
        this.ctx.update();
        return ok();
      }
      const [r, c] = this.sequence[this.pos++];
      const cell = this.pyramid[r][c];
      cell.revealed = true;
      const value = this.rows - r;
      this.current = { r, c, card: cell.card, value };
      this.ctx.log(`Se destapa ${pretty(cell.card)} · vale ${value} ${value === 1 ? 'trago' : 'tragos'} por carta`);
      this.ctx.update();
      return ok();
    }

    if (action === 'claim') {
      if (this.phase !== 'playing' || !this.current) return err('Todavía no hay carta destapada');
      const hand = this.hands[pid];
      if (!hand) return err('Estás mirando esta ronda');
      if (this.claims[pid]) return err('Ya reclamaste esta carta');
      const matches = hand.filter((c) => c[0] === this.current.card[0]).length;
      if (!matches) return err('No tienes una carta de ese número');
      const credit = matches * this.current.value;
      this.claims[pid] = { matches, credit, remaining: credit };
      this.ctx.addToGive(pid, credit);
      this.ctx.log(`✋ ${this.ctx.name(pid)} la tiene${matches > 1 ? ` (x${matches})` : ''} y reparte ${credit} ${credit === 1 ? 'trago' : 'tragos'}`);
      this.ctx.update();
      return ok();
    }
    return err('Acción desconocida');
  }

  view(pid) {
    const hand = this.hands[pid];
    let you = null;
    if (hand) {
      const rank = this.current ? this.current.card[0] : null;
      const matches = rank ? hand.filter((c) => c[0] === rank).length : 0;
      const claim = this.claims[pid];
      you = { hand, matches, claimed: !!claim, credit: claim ? claim.credit : 0, remaining: claim ? claim.remaining : 0 };
    }
    return {
      type: 'piramide',
      phase: this.phase,
      rows: this.rows,
      handSize: this.handSize,
      pyramid: this.pyramid.map((row) => row.map((cell) => ({ revealed: cell.revealed, card: cell.revealed ? cell.card : null }))),
      current: this.current,
      revealedCount: this.pos,
      total: this.sequence.length,
      canReveal: this.ctx.isHost(pid) && this.phase === 'playing',
      claimedBy: Object.entries(this.claims).map(([id, c]) => ({ id, credit: c.credit })),
      players: Object.keys(this.hands).map((id) => ({ id, count: this.hands[id].length })),
      you,
      hands: this.phase === 'finished' ? this.hands : null,
    };
  }
}

module.exports = Piramide;
