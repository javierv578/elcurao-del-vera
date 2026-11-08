/* Mayor o Menor: interfaz */
(function () {
  'use strict';
  const { esc, card } = Curao;
  const t = (n) => `${n} ${n === 1 ? 'trago' : 'tragos'}`;
  const WORD = { higher: 'mayor', lower: 'menor', equal: 'igual' };

  function lastHTML(g) {
    const l = g.last;
    if (!l) return '<p class="wait">Nadie ha jugado todavía.</p>';
    const who = esc(Curao.nameOf(l.playerId));
    const out = `salió ${esc(Curao.cardText(l.card))} (${WORD[l.actual]} que ${esc(Curao.cardText(l.from))})`;
    let res;
    if (!l.correct) res = `<b class="bad">${who} dijo ${WORD[l.guess]}, ${out}. Toma ${t(l.delta.amount)}.</b>`;
    else if (l.guess === 'equal') res = `<b class="good">${who} cantó igual y acertó: ${out}. Reparte ${t(l.delta.amount)}.</b>`;
    else res = `<b class="good">${who} dijo ${WORD[l.guess]} y acertó: ${out}.</b>`;
    return `<p class="last">${res}</p>`;
  }

  Curao.games.mayormenor = {
    render(g, room) {
      const myTurn = g.turn === room.you;
      const turner = room.players.find((p) => p.id === g.turn);
      const away = turner && turner.status !== 'online';
      return `
        <div class="game mm">
          <div class="game-head">
            <h2>Mayor o menor</h2>
            <span class="pill">Quedan ${g.deckLeft} cartas</span>
            <span class="pill pill-soft">El As es la más alta</span>
          </div>
          <div class="mm-table">
            <div class="mm-card">${card(g.current, { big: true, hl: true })}</div>
            <div class="mm-pozo"><small>Pozo de errores</small><b>${g.pozo}</b><small>${g.pozo === 1 ? 'trago' : 'tragos'}${g.pozo >= g.maxPozo ? ' (tope)' : ''}</small></div>
          </div>
          <p class="turnline ${myTurn ? 'mine' : ''}">${myTurn ? '<b>Te toca.</b> ¿La siguiente será mayor, menor o igual?' : `Le toca a <b>${esc(turner ? turner.name : '…')}</b>${away ? ` — ${turner.status === 'offline' ? 'está desconectado' : 'está inactivo'}. Puedes pedir su expulsión en La mesa.` : ''}`}</p>
          <div class="mm-actions">
            <button class="btn btn-primary" data-act="mm" data-g="higher" ${myTurn ? '' : 'disabled'}>Mayor ↑</button>
            <button class="btn btn-accent" data-act="mm" data-g="equal" ${myTurn ? '' : 'disabled'}>Igual =</button>
            <button class="btn btn-primary" data-act="mm" data-g="lower" ${myTurn ? '' : 'disabled'}>Menor ↓</button>
          </div>
          <p class="rules">Aciertas mayor o menor: el pozo sube 1. Fallas (o sale igual): te llevas el pozo. Cantas igual y aciertas: repartes el doble del pozo.</p>
          ${lastHTML(g)}
          <div class="history"><span class="hand-label">Últimas cartas</span>${g.history.slice(0, -1).map((c) => card(c, { small: true, dim: true })).join('')}</div>
        </div>`;
    },
  };
})();
