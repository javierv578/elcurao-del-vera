'use strict';
const crypto = require('crypto');

// Cartas como string de 2 caracteres: rango + palo. Ej: "As", "Td", "7h"
const RANKS = '23456789TJQKA'.split('');
const SUITS = ['c', 'd', 'h', 's'];
const VALUE = {};
RANKS.forEach((r, i) => (VALUE[r] = i + 2)); // 2..14 (As alto)

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function fullDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push(r + s);
  return d;
}

class Deck {
  constructor() {
    this.cards = shuffle(fullDeck());
    this.discards = [];
  }
  draw(n = 1) {
    const out = [];
    for (let i = 0; i < n; i++) {
      if (!this.cards.length) {
        if (!this.discards.length) throw new Error('Mazo vacío');
        this.cards = shuffle(this.discards);
        this.discards = [];
      }
      out.push(this.cards.pop());
    }
    return out;
  }
  discard(card) {
    this.discards.push(card);
  }
  get left() {
    return this.cards.length;
  }
}

const rankOf = (c) => c[0];
const suitOf = (c) => c[1];
const valueOf = (c) => VALUE[c[0]];

module.exports = { Deck, shuffle, rankOf, suitOf, valueOf, RANKS, SUITS };
