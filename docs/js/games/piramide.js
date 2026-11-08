/* La Pirámide: interfaz */
(function () {
  'use strict';
  const { esc, card } = Curao;
  const t = (n) => `${n} ${n === 1 ? 'trago' : 'tragos'}`;

  Curao.games.piramide = {
    render(g, room) {
      const cur = g.current;
      const y = g.you;
      const rowsHTML = g.pyramid
        .map((row, r) => {
          const value = g.rows - r;
          const cells = row
            .map((cell, c) => {
              const isCur = cur && cur.r === r && cur.c === c;
              if (!cell.revealed) return '<span class="card card-s card-back"></span>';
              return card(cell.card, { small: true, hl: isCur, dim: !isCur });
            })
            .join('');
          return `<div class="prow"><span class="pvalue" title="Cada carta de esta fila vale ${t(value)}">${value}</span><div class="pcards">${cells}</div></div>`;
        })
        .join('');

      let info;
      if (g.phase === 'finished') info = '<p class="wait big">Terminó la pirámide. Estas eran las manos de todos:</p>';
      else if (!cur) info = `<p class="wait big">${room.hostId === room.you ? 'Destapa la primera carta cuando todos hayan mirado su mano.' : 'Mira tu mano. El anfitrión destapa la primera carta.'}</p>`;
      else
        info = `<div class="current">
          <div class="current-card">${card(cur.card, { big: true, hl: true })}</div>
          <div class="current-txt"><b>Vale ${t(cur.value)} por carta</b>
            <span>Si tienes un ${esc(Curao.cardText(cur.card).slice(0, -1))} en tu mano, reclámalo y reparte.</span></div>
        </div>`;

      const claimed = g.claimedBy.length
        ? `<p class="claims">${g.claimedBy.map((c) => `✋ <b>${esc(Curao.nameOf(c.id))}</b> reparte ${c.credit}`).join(' · ')}</p>`
        : '';

      let mine = '';
      if (y) {
        const rank = cur ? cur.card[0] : null;
        mine = `<div class="hand">
          <span class="hand-label">Tu mano</span>
          ${y.hand.map((c) => card(c, { big: true, hl: rank && c[0] === rank })).join('')}
        </div>
        ${
          g.phase === 'playing' && cur
            ? `<button class="btn ${y.matches && !y.claimed ? 'btn-accent pulse' : ''}" data-act="pir-claim" ${y.claimed ? 'disabled' : ''}>
                ${y.claimed ? `Ya reclamaste (${y.credit})` : y.matches ? `¡La tengo! Repartir ${y.matches * cur.value}` : 'La tengo'}
              </button>`
            : ''
        }`;
      } else {
        mine = '<p class="wait">Estás mirando esta ronda. Entras en la próxima pirámide.</p>';
      }

      const host =
        g.canReveal
          ? `<button class="btn btn-primary" data-act="pir-reveal">${g.revealedCount >= g.total ? 'Terminar pirámide' : g.revealedCount === 0 ? 'Destapar la primera carta' : 'Destapar siguiente carta'}</button>`
          : '';

      const hands = g.hands
        ? `<ul class="final-hands">${Object.entries(g.hands)
            .map(([id, h]) => `<li><b>${esc(Curao.nameOf(id))}</b><div>${h.map((c) => card(c, { small: true })).join('')}</div></li>`)
            .join('')}</ul>`
        : '';

      return `
        <div class="game piramide">
          <div class="game-head">
            <h2>La pirámide</h2>
            <span class="pill">${g.revealedCount} de ${g.total} cartas</span>
          </div>
          <div class="pyramid">${rowsHTML}</div>
          ${info}
          ${claimed}
          ${hands}
          ${mine}
          <div class="host-row">${host}</div>
        </div>`;
    },
  };
})();
