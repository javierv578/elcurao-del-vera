/* Poker de Tragos: interfaz */
(function () {
  'use strict';
  const { esc, card } = Curao;
  const PHASE = { waiting: 'Esperando jugadores', preflop: 'Pre-flop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown' };
  const t = (n) => `${n} ${n === 1 ? 'trago' : 'tragos'}`;

  function seatHTML(s, g, room) {
    const p = room.players.find((x) => x.id === s.id);
    const turn = g.toAct === s.id;
    const you = s.id === room.you;
    const flags = [s.isDealer ? '<span class="tag tag-d" title="Reparte">D</span>' : '', s.isSB ? '<span class="tag">CP</span>' : '', s.isBB ? '<span class="tag">CG</span>' : ''].join('');
    const cls = ['pseat', turn ? 'turn' : '', s.folded ? 'folded' : '', !s.inHand ? 'out' : '', you ? 'you' : '', s.allIn ? 'allin-seat' : ''].join(' ');
    const status = !s.inHand ? (g.phase === 'waiting' ? '' : 'Mira esta mano') : s.folded ? 'Retirado' : s.last || '';
    return `<li class="${cls}">
      <div class="pseat-head"><b>${esc(p ? p.name : '???')}</b>${you ? ' <small>(tú)</small>' : ''}${flags}</div>
      <div class="pseat-cards">${s.cards.map((c) => card(c, { small: true })).join('')}</div>
      <div class="pseat-info">
        ${s.inHand ? `<span class="stack" title="Tragos que le quedan en la bolsa">🍺 ${s.stack}</span>` : ''}
        ${s.bet ? `<span class="bet" title="Apuesta en esta ronda">${s.bet}</span>` : ''}
      </div>
      <div class="pseat-status">${s.allIn && s.inHand && !s.folded ? '<b class="allin-badge">ALL-IN · al seco</b>' : esc(status)}</div>
    </li>`;
  }

  function resultHTML(g, room) {
    const r = g.result;
    if (!r) return '';
    const lines = r.pots
      .map((p) => {
        const who = p.winners.map((id) => esc(Curao.nameOf(id))).join(' y ');
        return `<li><b>🏆 ${who}</b> ${p.winners.length > 1 ? 'se reparten' : 'gana'} ${t(p.amount)}${p.desc ? ` con <em>${esc(p.desc)}</em>` : ' porque todos se retiraron'}</li>`;
      })
      .join('');
    const gives = Object.entries(r.net)
      .filter(([, n]) => n > 0)
      .map(([id, n]) => `${esc(Curao.nameOf(id))} reparte ${n}`)
      .join(' · ');
    return `<div class="result">
      <ul>${lines}</ul>
      ${gives ? `<p class="result-give">🎁 ${gives}</p>` : ''}
      <p class="result-next">Siguiente mano en <b data-until="${g.nextHandAt}">…</b>
        ${room.hostId === room.you ? '<button class="btn btn-small" data-act="poker-next">Repartir ya</button>' : ''}</p>
    </div>`;
  }

  function controls(g, room) {
    const y = g.you;
    if (!y) return `<p class="wait">Estás mirando esta mesa. Entras a jugar cuando parta la próxima mano.</p>`;
    if (y.folded) return `<p class="wait">Te retiraste. Espera la próxima mano.</p>`;
    if (g.phase === 'showdown' || g.phase === 'waiting') return '';
    if (!y.myTurn) {
      const actor = room.players.find((p) => p.id === g.toAct);
      const away = actor && actor.status !== 'online';
      return `<p class="wait">${actor ? `Le toca a <b>${esc(actor.name)}</b>` : 'Esperando…'}${away ? ` — ${actor.status === 'offline' ? 'está desconectado' : 'está inactivo'}. Puedes pedir su expulsión en La mesa.` : ''}</p>`;
    }
    const U = Curao.ui;
    const key = `${g.handNo}-${g.phase}-${g.toAct}-${g.currentBet}`;
    if (U.raiseKey !== key) {
      U.raiseKey = key;
      U.raiseTo = y.minRaiseTo;
    }
    U.raiseTo = Math.max(y.minRaiseTo, Math.min(y.maxRaiseTo, U.raiseTo));
    const raiseLabel = y.isBetting ? 'Apostar' : 'Subir a';
    return `<div class="actions">
      <div class="act-main">
        <button class="btn btn-danger" data-act="poker" data-a="fold" ${y.canCheck ? 'disabled title="Puedes pasar sin costo"' : ''}>Retirarme</button>
        ${y.canCheck ? '<button class="btn btn-primary" data-act="poker" data-a="check">Pasar</button>' : `<button class="btn btn-primary" data-act="poker" data-a="call">Igualar ${y.toCall}</button>`}
      </div>
      ${
        y.canRaise
          ? `<div class="raise">
              <div class="stepper">
                <button class="btn btn-small" data-act="raise-step" data-d="-1" aria-label="Bajar un trago">−</button>
                <output class="raise-val">${U.raiseTo}</output>
                <button class="btn btn-small" data-act="raise-step" data-d="1" aria-label="Subir un trago">+</button>
              </div>
              <div class="quick">
                <button class="btn btn-small btn-ghost" data-act="raise-set" data-v="min">Mínimo</button>
                <button class="btn btn-small btn-ghost" data-act="raise-set" data-v="half">½ pozo</button>
                <button class="btn btn-small btn-ghost" data-act="raise-set" data-v="pot">Pozo</button>
              </div>
              <button class="btn btn-accent" data-act="poker" data-a="raise">${raiseLabel} ${U.raiseTo}</button>
            </div>`
          : ''
      }
      ${y.canAllIn ? `<button class="btn btn-allin" data-act="poker" data-a="allin"><b>ALL-IN</b><small>${y.stack + y.bet} tragos · vaso lleno a fondo</small></button>` : ''}
    </div>`;
  }

  Curao.games.poker = {
    render(g, room) {
      const board = Array.from({ length: 5 }, (_, i) => (g.board[i] ? card(g.board[i], { big: true }) : '<span class="card card-l card-slot"></span>')).join('');
      const you = g.you;
      return `
        <div class="game poker">
          <div class="game-head">
            <h2>Poker de tragos</h2>
            <span class="pill">${PHASE[g.phase] || g.phase}${g.handNo ? ` · mano ${g.handNo}` : ''}</span>
            <span class="pill pill-soft">Ciegas ${g.smallBlind}/${g.bigBlind} · bolsa ${g.buyIn}</span>
          </div>
          ${g.phase === 'waiting' ? '<p class="wait big">Hacen falta al menos 2 jugadores conectados para repartir.</p>' : ''}
          <div class="felt">
            <div class="board">${board}</div>
            <div class="pot"><small>Pozo</small><b>${g.pot}</b><small>${g.pot === 1 ? 'trago' : 'tragos'}</small></div>
          </div>
          ${resultHTML(g, room)}
          <ul class="pseats">${g.seats.map((s) => seatHTML(s, g, room)).join('')}</ul>
          ${
            you && !you.folded
              ? `<div class="hand"><span class="hand-label">Tu mano</span>${you.hole.map((c) => card(c, { big: true })).join('')}</div>`
              : ''
          }
          ${controls(g, room)}
        </div>`;
    },
    // Acciones desde app.js
    pot(g) {
      return g.pot;
    },
  };
})();
