'use strict';
const { Deck, valueOf } = require('./deck');

const ok = () => ({ ok: true });
const err = (error) => ({ ok: false, error });
const MAX_POZO = 10;

/**
 * Mayor o Menor.
 * Hay una carta visible en el centro. El jugador en turno apuesta si la siguiente será
 * mayor, menor o igual (el As es la carta más alta).
 * - Acertar mayor/menor: el pozo de la mesa sube 1 trago y pasa el turno.
 * - Fallar (incluye que salga igual cuando dijiste mayor/menor): te llevas el pozo completo
 *   como tragos por tomar y el pozo vuelve a 1.
 * - Acertar "igual": repartes el doble del pozo y el pozo vuelve a 1.
 */
class MayorMenor {
  constructor(ctx, playerIds) {
    this.ctx = ctx;
    this.type = 'mayormenor';
    this.order = [...playerIds];
    this.turnIdx = 0;
    this.deck = new Deck();
    this.current = this.deck.draw(1)[0];
    this.history = [this.current];
    this.streak = 0;
    this.last = null;
    this.actorSince = Date.now();
    this.plays = 0;
  }

  get turn() {
    return this.order.length ? this.order[this.turnIdx % this.order.length] : null;
  }
  get pozo() {
    return Math.min(1 + this.streak, MAX_POZO);
  }

  has(id) {
    return this.order.includes(id);
  }
  currentActor() {
    return this.turn ? { id: this.turn, since: this.actorSince } : null;
  }
  destroy() {}
  onReconnect() {}
  addPlayer(id) {
    if (!this.order.includes(id)) this.order.push(id);
    this.ctx.update();
  }
  removePlayer(id) {
    const i = this.order.indexOf(id);
    if (i === -1) return;
    this.order.splice(i, 1);
    if (i < this.turnIdx) this.turnIdx--;
    if (this.order.length) this.turnIdx %= this.order.length;
    else this.turnIdx = 0;
    if (i === this.turnIdx || i < this.turnIdx) this.actorSince = Date.now();
    this.ctx.update();
  }

  handle(pid, action, payload = {}) {
    if (action !== 'guess') return err('Acción desconocida');
    if (this.turn !== pid) return err('No es tu turno');
    const guess = payload.guess;
    if (!['higher', 'lower', 'equal'].includes(guess)) return err('Elige mayor, menor o igual');

    const prev = this.current;
    const next = this.deck.draw(1)[0];
    const diff = valueOf(next) - valueOf(prev);
    const actual = diff > 0 ? 'higher' : diff < 0 ? 'lower' : 'equal';
    const correct = guess === actual;
    const name = this.ctx.name(pid);
    const pozo = this.pozo;
    let delta;

    if (!correct) {
      this.ctx.addPending(pid, pozo);
      delta = { kind: 'drink', amount: pozo };
      this.streak = 0;
      this.ctx.log(`❌ ${name} falló${actual === 'equal' ? ' (salió igual)' : ''} y toma ${pozo} ${pozo === 1 ? 'trago' : 'tragos'}`);
    } else if (guess === 'equal') {
      const give = pozo * 2;
      this.ctx.addToGive(pid, give);
      delta = { kind: 'give', amount: give };
      this.streak = 0;
      this.ctx.log(`🎯 ¡${name} cantó igual y acertó! Reparte ${give} tragos`);
    } else {
      this.streak++;
      delta = { kind: 'safe', amount: 0 };
      this.ctx.log(`✅ ${name} acertó. El pozo sube a ${this.pozo}`);
    }

    this.last = { playerId: pid, guess, from: prev, card: next, actual, correct, delta };
    this.deck.discard(prev);
    this.current = next;
    this.history.push(next);
    if (this.history.length > 12) this.history.shift();
    this.plays++;
    this.turnIdx = (this.turnIdx + 1) % this.order.length;
    this.actorSince = Date.now();
    this.ctx.update();
    return ok();
  }

  view() {
    return {
      type: 'mayormenor',
      current: this.current,
      pozo: this.pozo,
      maxPozo: MAX_POZO,
      streak: this.streak,
      turn: this.turn,
      turnSince: this.actorSince,
      order: this.order,
      last: this.last,
      history: this.history,
      deckLeft: this.deck.left,
      plays: this.plays,
    };
  }
}

module.exports = MayorMenor;
