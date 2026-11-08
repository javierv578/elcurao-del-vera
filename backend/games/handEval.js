'use strict';
const { valueOf, suitOf } = require('./deck');

// Puntaje = arreglo comparable lexicográficamente: [categoría, desempates...]
// 8 escalera de color, 7 póker, 6 full, 5 color, 4 escalera, 3 trío, 2 doble par, 1 par, 0 carta alta
function eval5(cards) {
  const vals = cards.map(valueOf).sort((a, b) => b - a);
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]));
  const uniq = new Set(vals);
  let straightHigh = 0;
  if (uniq.size === 5) {
    if (vals[0] - vals[4] === 4) straightHigh = vals[0];
    else if (vals[0] === 14 && vals[1] === 5 && vals[4] === 2) straightHigh = 5; // rueda A-2-3-4-5
  }
  const counts = {};
  vals.forEach((v) => (counts[v] = (counts[v] || 0) + 1));
  const groups = Object.entries(counts)
    .map(([v, c]) => [c, Number(v)])
    .sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const shape = groups.map((g) => g[0]).join('');

  if (straightHigh && flush) return [8, straightHigh];
  if (shape === '41') return [7, groups[0][1], groups[1][1]];
  if (shape === '32') return [6, groups[0][1], groups[1][1]];
  if (flush) return [5, ...vals];
  if (straightHigh) return [4, straightHigh];
  if (shape === '311') return [3, groups[0][1], groups[1][1], groups[2][1]];
  if (shape === '221') return [2, groups[0][1], groups[1][1], groups[2][1]];
  if (shape === '2111') return [1, groups[0][1], groups[1][1], groups[2][1], groups[3][1]];
  return [0, ...vals];
}

function compareScores(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}

function combos(arr, k, start = 0, cur = [], out = []) {
  if (cur.length === k) {
    out.push(cur.slice());
    return out;
  }
  for (let i = start; i <= arr.length - (k - cur.length); i++) {
    cur.push(arr[i]);
    combos(arr, k, i + 1, cur, out);
    cur.pop();
  }
  return out;
}

function bestOfSeven(cards) {
  let best = null;
  for (const five of combos(cards, 5)) {
    const s = eval5(five);
    if (!best || compareScores(s, best) > 0) best = s;
  }
  return best;
}

const SINGULAR = { 14: 'As', 13: 'Rey', 12: 'Reina', 11: 'Jota', 10: 'Diez', 9: 'Nueve', 8: 'Ocho', 7: 'Siete', 6: 'Seis', 5: 'Cinco', 4: 'Cuatro', 3: 'Tres', 2: 'Dos' };
const PLURAL = { 14: 'Ases', 13: 'Reyes', 12: 'Reinas', 11: 'Jotas', 10: 'Dieces', 9: 'Nueves', 8: 'Ochos', 7: 'Sietes', 6: 'Seises', 5: 'Cincos', 4: 'Cuatros', 3: 'Treses', 2: 'Doses' };

function describeScore(s) {
  switch (s[0]) {
    case 8: return s[1] === 14 ? 'Escalera real' : `Escalera de color al ${SINGULAR[s[1]]}`;
    case 7: return `Póker de ${PLURAL[s[1]]}`;
    case 6: return `Full de ${PLURAL[s[1]]} y ${PLURAL[s[2]]}`;
    case 5: return `Color al ${SINGULAR[s[1]]}`;
    case 4: return `Escalera al ${SINGULAR[s[1]]}`;
    case 3: return `Trío de ${PLURAL[s[1]]}`;
    case 2: return `Doble par de ${PLURAL[s[1]]} y ${PLURAL[s[2]]}`;
    case 1: return `Par de ${PLURAL[s[1]]}`;
    default: return `Carta alta ${SINGULAR[s[1]]}`;
  }
}

module.exports = { eval5, bestOfSeven, compareScores, describeScore };
