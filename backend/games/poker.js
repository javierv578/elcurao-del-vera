'use strict';
const { Deck } = require('./deck');
const { bestOfSeven, compareScores, describeScore } = require('./handEval');

const NEXT_HAND_MS = 10000;
const STREETS = ['preflop', 'flop', 'turn', 'river'];
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const toInt = (v, d) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : d;
};
const ok = () => ({ ok: true });
const err = (error) => ({ ok: false, error });

/**
 * Poker de Tragos (Texas Hold'em).
 * - Cada mano, cada jugador entra con una "bolsa" de `buyIn` tragos.
 * - Las apuestas van al pozo (en tragos). Al terminar la mano, lo que cada ganador
 *   ganó por encima de lo que puso pasa a su contador "por repartir"; los perdedores
 *   reciben ese castigo cuando los ganadores reparten.
 * - All-In = "Vaso lleno a fondo" (alerta global).
 */
class Poker {
  constructor(ctx, playerIds, opts = {}) {
    this.ctx = ctx;
    this.type = 'poker';
    this.buyIn = clamp(toInt(opts.buyIn, 10), 4, 50);
    this.smallBlind = clamp(toInt(opts.smallBlind, 1), 1, Math.max(1, Math.floor(this.buyIn / 4)));
    this.bigBlind = this.smallBlind * 2;
    this.seats = [...playerIds];
    this.handNo = 0;
    this.dealerPid = null;
    this.dealerSeatIdx = -1;
    this.phase = 'waiting';
    this.order = [];
    this.P = {};
    this.board = [];
    this.toAct = null;
    this.actorSince = 0;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.result = null;
    this.timer = null;
    this.nextHandAt = null;
    this.sbId = null;
    this.bbId = null;
    this.startHand();
  }

  // ---------- API del motor ----------
  has(id) {
    return this.seats.includes(id);
  }
  currentActor() {
    return this.toAct ? { id: this.toAct, since: this.actorSince } : null;
  }
  destroy() {
    clearTimeout(this.timer);
  }
  addPlayer(id) {
    if (this.seats.includes(id)) return;
    this.seats.push(id);
    if (this.phase === 'waiting') this.startHand();
    else this.ctx.update();
  }
  onReconnect() {
    if (this.phase === 'waiting') this.startHand();
  }
  removePlayer(id) {
    const i = this.seats.indexOf(id);
    if (i === -1) return;
    this.seats.splice(i, 1);
    if (this.dealerPid === id) this.dealerSeatIdx = i - 1;
    else if (this.dealerPid) this.dealerSeatIdx = this.seats.indexOf(this.dealerPid);
    const p = this.P[id];
    if (p && this.order.includes(id) && !p.folded && STREETS.includes(this.phase)) {
      p.folded = true;
      p.last = 'Salió';
      if (this.toAct === id) this.proceed(id, false);
      else if (this.order.filter((x) => !this.P[x].folded).length <= 1) this.proceed(id, false);
    }
    this.ctx.update();
  }

  handle(pid, action, payload = {}) {
    if (action === 'nextHand') {
      if (!this.ctx.isHost(pid)) return err('Solo el anfitrión puede adelantar la mano');
      if (this.phase !== 'showdown') return err('La mano aún no termina');
      this.startHand();
      return ok();
    }
    if (!STREETS.includes(this.phase)) return err('No hay una mano en curso');
    if (this.toAct !== pid) return err('No es tu turno');
    const p = this.P[pid];
    const toCall = this.currentBet - p.bet;

    switch (action) {
      case 'fold':
        if (toCall <= 0) return err('Puedes pasar (check) en vez de retirarte');
        p.folded = true;
        p.last = 'Se retira';
        this.ctx.log(`${this.ctx.name(pid)} se retira`);
        break;
      case 'check':
        if (toCall > 0) return err('Debes igualar, subir o retirarte');
        p.acted = true;
        p.last = 'Pasa';
        break;
      case 'call': {
        if (toCall <= 0) {
          p.acted = true;
          p.last = 'Pasa';
          break;
        }
        const amt = this.commit(p, Math.min(toCall, p.stack));
        p.acted = true;
        p.last = `Iguala ${amt}`;
        if (p.allIn) this.declareAllIn(pid);
        break;
      }
      case 'raise': {
        const to = toInt(payload.amount, NaN);
        if (!Number.isFinite(to)) return err('Monto inválido');
        const maxTo = p.bet + p.stack;
        if (to >= maxTo) {
          this.raiseTo(pid, maxTo);
          p.last = `ALL-IN ${p.total}`;
          this.declareAllIn(pid);
          break;
        }
        if (p.raiseLocked) return err('No puedes volver a subir: la apuesta no se reabrió');
        if (to <= this.currentBet) return err('Debes subir por encima de la apuesta actual');
        if (to - this.currentBet < this.minRaise) return err(`Subida mínima: ${this.currentBet + this.minRaise}`);
        this.raiseTo(pid, to);
        p.last = this.currentBet === to && toCall === 0 && this.phase !== 'preflop' ? `Apuesta ${to}` : `Sube a ${to}`;
        break;
      }
      case 'allin': {
        const to = p.bet + p.stack;
        if (p.stack <= 0) return err('No te quedan tragos');
        if (to > this.currentBet) this.raiseTo(pid, to);
        else {
          this.commit(p, p.stack);
          p.acted = true;
        }
        p.last = `ALL-IN ${p.total}`;
        this.declareAllIn(pid);
        break;
      }
      default:
        return err('Acción desconocida');
    }
    this.proceed(pid, false);
    return ok();
  }

  // ---------- Mano ----------
  startHand() {
    clearTimeout(this.timer);
    this.timer = null;
    this.nextHandAt = null;
    this.result = null;
    const elig = this.seats.filter((id) => this.ctx.isConnected(id));
    if (elig.length < 2) {
      this.phase = 'waiting';
      this.P = {};
      this.order = [];
      this.board = [];
      this.toAct = null;
      this.ctx.update();
      return;
    }
    this.handNo++;
    this.deck = new Deck();
    this.board = [];
    this.order = this.seats.filter((id) => elig.includes(id));

    let idx = this.dealerSeatIdx;
    for (let k = 1; k <= this.seats.length; k++) {
      const j = (idx + k) % this.seats.length;
      if (elig.includes(this.seats[j])) {
        idx = j;
        break;
      }
    }
    this.dealerSeatIdx = idx;
    this.dealerPid = this.seats[idx];

    this.P = {};
    for (const id of this.order) {
      this.P[id] = { hole: this.deck.draw(2), stack: this.buyIn, bet: 0, total: 0, folded: false, allIn: false, declared: false, acted: false, raiseLocked: false, last: null };
    }
    const n = this.order.length;
    const dpos = this.order.indexOf(this.dealerPid);
    const at = (k) => this.order[(dpos + k) % n];
    let first;
    if (n === 2) {
      this.sbId = at(0);
      this.bbId = at(1);
      first = this.sbId;
    } else {
      this.sbId = at(1);
      this.bbId = at(2);
      first = at(3);
    }
    this.commit(this.P[this.sbId], this.smallBlind);
    this.commit(this.P[this.bbId], this.bigBlind);
    this.P[this.sbId].last = `Ciega ${this.P[this.sbId].bet}`;
    this.P[this.bbId].last = `Ciega ${this.P[this.bbId].bet}`;
    this.currentBet = Math.max(...this.order.map((id) => this.P[id].bet));
    this.minRaise = this.bigBlind;
    this.phase = 'preflop';
    this.ctx.log(`Mano #${this.handNo}: reparte ${this.ctx.name(this.dealerPid)}. Ciegas ${this.smallBlind}/${this.bigBlind}, bolsa de ${this.buyIn} tragos`);
    this.proceed(first, true);
  }

  commit(p, amt) {
    amt = Math.max(0, Math.min(amt, p.stack));
    p.stack -= amt;
    p.bet += amt;
    p.total += amt;
    if (p.stack === 0) p.allIn = true;
    return amt;
  }

  raiseTo(id, to) {
    const p = this.P[id];
    const size = to - this.currentBet;
    const full = size >= this.minRaise;
    this.commit(p, to - p.bet);
    this.currentBet = Math.max(this.currentBet, to);
    p.acted = true;
    p.raiseLocked = false;
    for (const oid of this.order) {
      if (oid === id) continue;
      const o = this.P[oid];
      if (o.folded || o.allIn) continue;
      if (full) {
        o.acted = false;
        o.raiseLocked = false;
      } else if (o.acted) {
        o.raiseLocked = true;
      }
    }
    if (full) this.minRaise = size;
  }

  declareAllIn(id) {
    const p = this.P[id];
    if (!p.allIn || p.declared) return;
    p.declared = true;
    const name = this.ctx.name(id);
    this.ctx.log(`🔥 ¡${name} se va ALL-IN con ${p.total} tragos! Vaso lleno a fondo`);
    this.ctx.alert({
      kind: 'all_in',
      playerId: id,
      name,
      amount: p.total,
      title: '¡ALL-IN!',
      text: `${name} se juega ${p.total} tragos`,
      penalty: 'Vaso lleno a fondo (¡al seco!)',
    });
  }

  needsAction(id) {
    const p = this.P[id];
    if (p.folded || p.allIn) return false;
    const live = this.order.filter((x) => !this.P[x].folded && !this.P[x].allIn);
    if (live.length <= 1 && p.bet >= this.currentBet) return false;
    return !p.acted || p.bet < this.currentBet;
  }

  findNext(fromId, inclusive) {
    const n = this.order.length;
    let i = this.order.indexOf(fromId);
    if (!inclusive) i++;
    if (i < 0) i = 0;
    for (let k = 0; k < n; k++) {
      const id = this.order[(i + k) % n];
      if (this.needsAction(id)) return id;
    }
    return null;
  }

  proceed(afterId, inclusive) {
    const alive = this.order.filter((id) => !this.P[id].folded);
    if (alive.length === 0) {
      this.phase = 'waiting';
      this.toAct = null;
      this.ctx.update();
      return;
    }
    if (alive.length === 1) return this.finishUncontested(alive[0]);
    const next = this.findNext(afterId, inclusive);
    if (next) {
      this.toAct = next;
      this.actorSince = Date.now();
      this.ctx.update();
      return;
    }
    this.toAct = null;
    this.endRound();
  }

  endRound() {
    for (const id of this.order) {
      const p = this.P[id];
      p.bet = 0;
      p.acted = false;
      p.raiseLocked = false;
      if (!p.folded && !p.allIn) p.last = null;
    }
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    switch (this.phase) {
      case 'preflop':
        this.phase = 'flop';
        this.board.push(...this.deck.draw(3));
        break;
      case 'flop':
        this.phase = 'turn';
        this.board.push(...this.deck.draw(1));
        break;
      case 'turn':
        this.phase = 'river';
        this.board.push(...this.deck.draw(1));
        break;
      default:
        return this.showdown();
    }
    this.proceed(this.dealerPid, false);
  }

  potTotal() {
    return this.order.reduce((s, id) => s + this.P[id].total, 0);
  }

  finishUncontested(winnerId) {
    const pot = this.potTotal();
    this.conclude({ [winnerId]: pot }, [{ amount: pot, winners: [winnerId], desc: null }], false, {});
  }

  showdown() {
    const alive = this.order.filter((id) => !this.P[id].folded);
    const scores = {};
    const hands = {};
    for (const id of alive) {
      scores[id] = bestOfSeven([...this.P[id].hole, ...this.board]);
      hands[id] = describeScore(scores[id]);
    }
    const levels = [...new Set(alive.map((id) => this.P[id].total))].sort((a, b) => a - b);
    const slice = (lo, hi) => this.order.reduce((s, id) => s + Math.min(this.P[id].total, hi) - Math.min(this.P[id].total, lo), 0);
    const pots = [];
    let prev = 0;
    for (const lvl of levels) {
      const amount = slice(prev, lvl);
      const elig = alive.filter((id) => this.P[id].total >= lvl);
      if (amount > 0 && elig.length) pots.push({ amount, elig });
      prev = lvl;
    }
    const maxAll = Math.max(...this.order.map((id) => this.P[id].total));
    if (maxAll > prev && pots.length) pots[pots.length - 1].amount += slice(prev, maxAll);

    // Orden para repartir fichas impares: desde la izquierda del dealer
    const dpos = this.order.indexOf(this.dealerPid);
    const ring = this.order.map((_, k) => this.order[(dpos + 1 + k) % this.order.length]);

    const winnings = {};
    const outPots = [];
    for (const pot of pots) {
      let best = null;
      let winners = [];
      for (const id of pot.elig) {
        const c = best ? compareScores(scores[id], best) : 1;
        if (c > 0) {
          best = scores[id];
          winners = [id];
        } else if (c === 0) winners.push(id);
      }
      winners.sort((a, b) => ring.indexOf(a) - ring.indexOf(b));
      const share = Math.floor(pot.amount / winners.length);
      let rest = pot.amount - share * winners.length;
      for (const w of winners) {
        winnings[w] = (winnings[w] || 0) + share + (rest > 0 ? 1 : 0);
        if (rest > 0) rest--;
      }
      outPots.push({ amount: pot.amount, winners, desc: hands[winners[0]] });
    }
    this.conclude(winnings, outPots, true, hands);
  }

  conclude(winnings, pots, showdown, hands) {
    const net = {};
    for (const id of this.order) net[id] = (winnings[id] || 0) - this.P[id].total;
    for (const id of this.order) if (net[id] > 0) this.ctx.addToGive(id, net[id]);

    const lostAllIn = this.order.filter((id) => this.P[id].declared && net[id] < 0);
    if (lostAllIn.length) {
      const names = lostAllIn.map((id) => this.ctx.name(id)).join(' y ');
      this.ctx.log(`💀 ${names} perdió el All-In: vaso lleno a fondo`);
      this.ctx.alert({
        kind: 'all_in_lost',
        title: '¡Perdió el All-In!',
        text: `${names} ${lostAllIn.length > 1 ? 'perdieron' : 'perdió'} la apuesta`,
        penalty: 'Vaso lleno a fondo (¡al seco!)',
      });
    }
    for (const pot of pots) {
      const who = pot.winners.map((id) => this.ctx.name(id)).join(' y ');
      this.ctx.log(`🏆 ${who} ${pot.winners.length > 1 ? 'se reparten' : 'gana'} ${pot.amount} tragos${pot.desc ? ` con ${pot.desc}` : ' (todos se retiraron)'}`);
    }
    this.phase = 'showdown';
    this.toAct = null;
    this.result = { showdown, pots, net, hands };
    this.nextHandAt = Date.now() + NEXT_HAND_MS;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.startHand(), NEXT_HAND_MS);
    this.ctx.update();
  }

  // ---------- Vista privada por jugador ----------
  view(pid) {
    const showAll = this.phase === 'showdown' && this.result && this.result.showdown;
    const seats = this.seats.map((id) => {
      const p = this.P[id];
      const inHand = !!p && this.order.includes(id);
      let cards = [];
      if (inHand && !p.folded) cards = id === pid || showAll ? p.hole : [null, null];
      return {
        id,
        inHand,
        stack: p ? p.stack : null,
        bet: p ? p.bet : 0,
        total: p ? p.total : 0,
        folded: !!(p && p.folded),
        allIn: !!(p && p.allIn),
        last: p ? p.last : null,
        cards,
        isDealer: id === this.dealerPid,
        isSB: inHand && id === this.sbId,
        isBB: inHand && id === this.bbId,
      };
    });
    let you = null;
    const me = this.P[pid];
    if (me && this.order.includes(pid)) {
      const myTurn = this.toAct === pid && STREETS.includes(this.phase);
      const toCall = Math.max(0, this.currentBet - me.bet);
      const maxTo = me.bet + me.stack;
      const minTo = this.currentBet + this.minRaise;
      you = {
        hole: me.hole,
        stack: me.stack,
        bet: me.bet,
        folded: me.folded,
        myTurn,
        toCall: Math.min(toCall, me.stack),
        canCheck: myTurn && toCall === 0,
        canCall: myTurn && toCall > 0,
        canRaise: myTurn && !me.raiseLocked && maxTo >= minTo && me.stack > toCall,
        canAllIn: myTurn && me.stack > 0,
        minRaiseTo: Math.min(minTo, maxTo),
        maxRaiseTo: maxTo,
        isBetting: this.currentBet === 0,
      };
    }
    return {
      type: 'poker',
      phase: this.phase,
      handNo: this.handNo,
      board: this.board,
      pot: this.potTotal(),
      buyIn: this.buyIn,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      currentBet: this.currentBet,
      toAct: this.toAct,
      actorSince: this.actorSince,
      seats,
      you,
      result: this.result,
      nextHandAt: this.nextHandAt,
    };
  }
}

module.exports = Poker;
