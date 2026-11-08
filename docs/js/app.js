/* Arranque, render de la sala y eventos */
(function () {
  'use strict';
  const C = window.Curao;
  const { esc } = C;
  const $ = (id) => document.getElementById(id);
  const roomParam = (new URLSearchParams(location.search).get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  const t = (n) => `${n} ${n === 1 ? 'trago' : 'tragos'}`;

  const GAMES = [
    {
      type: 'poker',
      title: 'Poker de tragos',
      text: "Texas Hold'em apostando tragos al pozo. Quien se va All-In juega el vaso lleno a fondo.",
      min: 2,
      opts: [
        { key: 'buyIn', label: 'Bolsa por mano', values: [6, 10, 15, 20], def: 10, unit: 'tragos' },
        { key: 'smallBlind', label: 'Ciega chica', values: [1, 2], def: 1, unit: '' },
      ],
    },
    {
      type: 'piramide',
      title: 'La pirámide',
      text: 'Cada uno recibe cartas en secreto. Se destapa la pirámide y quien tenga la carta reparte tragos.',
      min: 2,
      opts: [
        { key: 'rows', label: 'Filas', values: [4, 5, 6], def: 5, unit: '' },
        { key: 'handSize', label: 'Cartas por jugador', values: [3, 4, 5], def: 4, unit: '' },
      ],
    },
    {
      type: 'mayormenor',
      title: 'Mayor o menor',
      text: 'Un mazo al centro. Adivina si la siguiente carta es mayor, menor o igual. Si fallas, te llevas el pozo.',
      min: 2,
      opts: [],
    },
  ];

  // ---------- Vistas ----------
  function showView(name) {
    $('view-home').hidden = name !== 'home';
    $('view-room').hidden = name !== 'room';
  }
  function banner(text) {
    const b = $('conn-banner');
    b.textContent = text || '';
    b.hidden = !text;
  }
  function homeError(msg) {
    const e = $('home-error');
    e.textContent = msg || '';
    e.hidden = !msg;
  }
  function goHome(msg) {
    C.state = null;
    showView('home');
    if (msg) homeError(msg);
    history.replaceState(null, '', location.pathname);
  }

  // ---------- Conexión ----------
  // El cliente de Socket.io se pide al propio backend (misma versión que el servidor).
  // Si falla (servidor dormido o caído), se reintenta y como último recurso se usa el CDN.
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => {
        s.remove();
        reject(new Error('No cargó ' + src));
      };
      document.head.appendChild(s);
    });
  }
  async function loadSocketClient(url) {
    const sources = [`${url}/socket.io/socket.io.js`, 'https://cdn.socket.io/4.7.5/socket.io.min.js'];
    for (let attempt = 0; !window.io; attempt++) {
      try {
        await loadScript(sources[attempt >= 3 ? 1 : 0]);
      } catch (e) {
        banner('Despertando el servidor… puede tardar hasta un minuto en la primera visita.');
        await new Promise((r) => setTimeout(r, Math.min(1500 * (attempt + 1), 6000)));
      }
    }
  }

  async function connect() {
    const url = C.serverUrl();
    if (!url || url.includes('TU-SERVICIO')) {
      homeError('Falta poner la URL de tu servidor en docs/js/config.js (SERVER_URL).');
      return;
    }
    banner('Conectando con el servidor… si estaba dormido puede tardar hasta un minuto.');
    await loadSocketClient(url);
    const socket = (C.socket = io(url, { transports: ['websocket', 'polling'], reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 5000 }));
    socket.on('connect', onConnect);
    socket.on('disconnect', () => banner('Se cortó la conexión. Reconectando… tu lugar queda guardado.'));
    socket.on('connect_error', () => banner('No pudimos conectar con el servidor. Reintentando…'));
    socket.on('state', (s) => {
      C.state = s;
      C.serverOffset = s.room.serverTime - Date.now();
      showView('room');
      render();
    });
    socket.on('alert', (a) => C.showAlert(a));
    socket.on('received', (r) => {
      C.toast(`${r.from} te reparte ${t(r.amount)} 🍺`, 'drink');
      if (navigator.vibrate) navigator.vibrate(150);
    });
    socket.on('kicked', () => {
      C.session.clear();
      goHome('La mesa votó expulsarte de la sala. Puedes crear otra o entrar de nuevo con el código.');
    });
    socket.on('session:replaced', () => {
      banner('');
      goHome('Abriste la sala en otra pestaña. Esta quedó inactiva; usa la nueva.');
      C.socket.disconnect();
    });
  }

  async function onConnect() {
    banner('');
    const s = C.session.get();
    if (!s || (roomParam && roomParam !== s.code && $('view-room').hidden)) return;
    const res = await C.emit('session:resume', { code: s.code, token: s.token });
    if (res.ok) {
      showView('room');
    } else if (res.fatal) {
      C.session.clear();
      goHome(res.error);
    }
  }

  // ---------- Inicio ----------
  async function enterRoom(kind) {
    homeError('');
    const name = $('in-name').value.trim();
    if (!name) return homeError('Escribe tu nombre para sentarte en la mesa.');
    C.session.saveName(name);
    let res;
    if (kind === 'create') res = await C.emit('room:create', { name });
    else {
      const code = $('in-code').value.toUpperCase().replace(/[^A-Z]/g, '');
      if (code.length !== 4) return homeError('El código tiene 4 letras. Ejemplo: ABCD');
      const s = C.session.get();
      res = await C.emit('room:join', { code, name, token: s && s.code === code ? s.token : undefined });
    }
    if (!res.ok) return homeError(res.error);
    C.session.set({ code: res.code, token: res.token, name });
    history.replaceState(null, '', `${location.pathname}?room=${res.code}`);
    showView('room');
  }

  // ---------- Render de la sala ----------
  function render() {
    const s = C.state;
    if (!s) return;
    const { room, game } = s;
    const me = room.players.find((p) => p.id === room.you);
    if (!me) return;
    $('room-code').textContent = room.code;
    $('top-mine').innerHTML = `<span title="Tragos acumulados por tomar">🍺 <b>${me.pendientes}</b></span><span title="Tragos disponibles para repartir">🎁 <b>${me.repartir}</b></span>`;
    renderDash(room, game, me);
    renderStage(room, game, me);
    renderMyBar(room, me);
    renderLog(room);
    renderVote(room, me);
    tickCountdowns();
  }

  const STATUS = { offline: 'Desconectado', idle: 'Inactivo', online: '' };

  function renderDash(room, game, me) {
    const actor = game ? game.toAct || game.turn : null;
    $('dash-count').textContent = `${room.players.length}/${room.maxPlayers}`;
    $('players').innerHTML = room.players
      .map((p) => {
        const isMe = p.id === me.id;
        const spectator = room.gameType && !p.inGame;
        return `<li class="prow-d ${p.status} ${isMe ? 'me' : ''} ${actor === p.id ? 'turn' : ''}">
          <span class="seat" title="Asiento ${p.seat + 1}">${p.seat + 1}</span>
          <div class="pname">
            <span class="pline"><b>${esc(p.name)}</b>${p.isHost ? ' <span title="Anfitrión">👑</span>' : ''}${isMe ? ' <small>(tú)</small>' : ''}</span>
            <small class="pstatus">${[STATUS[p.status], spectator ? 'mirando' : '', actor === p.id ? 'su turno' : ''].filter(Boolean).join(' · ')}</small>
          </div>
          <div class="counters">
            <span class="c-drink" title="Tragos acumulados por tomar"><i>🍺</i><b>${p.pendientes}</b></span>
            <span class="c-give" title="Tragos disponibles para repartir"><i>🎁</i><b>${p.repartir}</b></span>
          </div>
          ${isMe ? '' : `<button class="btn btn-small btn-kick" data-act="kick" data-target="${p.id}" ${p.kickable ? '' : 'disabled'} title="${p.kickable ? 'Proponer expulsión (vota la mesa)' : 'Solo se puede expulsar a quien está desconectado o inactivo'}">Expulsar</button>`}
        </li>`;
      })
      .join('');
  }

  function lobbyHTML(room, me) {
    const host = room.players.find((p) => p.id === room.hostId);
    const isHost = me.id === room.hostId;
    const online = room.players.filter((p) => p.connected).length;
    const cards = GAMES.map((g) => {
      const saved = (C.ui.opts[g.type] = C.ui.opts[g.type] || {});
      const opts = g.opts
        .map((o) => {
          const cur = saved[o.key] ?? o.def;
          return `<label class="opt">${o.label}
            <select data-opt="${g.type}.${o.key}" ${isHost ? '' : 'disabled'}>${o.values.map((v) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${v}${o.unit ? ' ' + o.unit : ''}</option>`).join('')}</select></label>`;
        })
        .join('');
      return `<article class="gcard">
        <h3>${g.title}</h3>
        <p>${g.text}</p>
        ${opts ? `<div class="opts">${opts}</div>` : ''}
        ${isHost ? `<button class="btn btn-primary" data-act="start" data-type="${g.type}" ${online < g.min ? 'disabled' : ''}>Jugar ${g.title.toLowerCase()}</button>` : ''}
      </article>`;
    }).join('');
    return `<div class="lobby">
      <div class="invite">
        <p class="invite-code"><small>Código de la sala</small><b>${room.code}</b></p>
        <p>Comparte el código o el enlace. ${isHost ? '' : `Esperando que <b>${esc(host ? host.name : 'el anfitrión')}</b> elija el juego.`}</p>
        ${online < 2 ? '<p class="note">Se necesitan al menos 2 jugadores conectados para empezar.</p>' : ''}
      </div>
      <div class="gcards">${cards}</div>
    </div>`;
  }

  function renderStage(room, game, me) {
    const stage = $('stage');
    if (!game) {
      // No reemplazar el lobby si hay un select abierto: se re-renderiza solo si cambió
      stage.innerHTML = lobbyHTML(room, me);
      return;
    }
    const mod = C.games[game.type];
    const stop = me.id === room.hostId ? '<button class="btn btn-small btn-ghost stop" data-act="stop">Terminar juego</button>' : '';
    stage.innerHTML = mod.render(game, room, me) + stop;
  }

  function renderMyBar(room, me) {
    const U = C.ui;
    U.giveAmt = Math.max(1, Math.min(me.repartir || 1, U.giveAmt));
    const others = room.players.filter((p) => p.id !== me.id);
    $('mybar').innerHTML = `
      <h2>Mis tragos</h2>
      <div class="mine-row">
        <span>🍺 Por tomar</span><b class="big-n">${me.pendientes}</b>
        ${me.pendientes ? `<div class="btns"><button class="btn btn-small" data-act="drink" data-n="1">Ya tomé 1</button>${me.pendientes > 1 ? '<button class="btn btn-small btn-ghost" data-act="drink" data-n="all">Ya tomé todo</button>' : ''}</div>` : ''}
      </div>
      <div class="mine-row">
        <span>🎁 Por repartir</span><b class="big-n gold">${me.repartir}</b>
      </div>
      ${
        me.repartir
          ? `<div class="give">
              <div class="stepper">
                <button class="btn btn-small" data-act="give-step" data-d="-1" aria-label="Menos">−</button>
                <output>${U.giveAmt}</output>
                <button class="btn btn-small" data-act="give-step" data-d="1" aria-label="Más">+</button>
                <button class="btn btn-small btn-ghost" data-act="give-step" data-d="all">Todo</button>
              </div>
              <p class="give-label">Repartir ${t(U.giveAmt)} a:</p>
              <div class="targets">${others.length ? others.map((p) => `<button class="btn btn-accent btn-small" data-act="give" data-to="${p.id}">${esc(p.name)}</button>`).join('') : '<small>No hay a quién repartirle todavía.</small>'}</div>
            </div>`
          : ''
      }`;
  }

  function renderLog(room) {
    $('log').innerHTML = room.log
      .slice()
      .reverse()
      .map((l) => `<li><time>${new Date(l.t).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</time> ${esc(l.text)}</li>`)
      .join('');
  }

  function renderVote(room, me) {
    const v = room.vote;
    const layer = $('vote-layer');
    if (!v) {
      layer.innerHTML = '';
      return;
    }
    if (v.targetId === me.id) {
      layer.innerHTML = `<div class="vote vote-self" role="alert"><b>La mesa está votando expulsarte.</b> Toca la pantalla para avisar que sigues aquí.</div>`;
      return;
    }
    if (!v.canVote) {
      layer.innerHTML = '';
      return;
    }
    layer.innerHTML = `<div class="vote" role="alertdialog" aria-label="Votación para expulsar">
      <p><b>${esc(v.initiatorName)}</b> propone expulsar a <b>${esc(v.targetName)}</b>. Su asiento y sus tragos se borran.</p>
      <p class="tally">${v.yes} a favor · ${v.no} en contra · se necesitan ${v.needed} de ${v.eligible} · <b data-until="${v.expiresAt}">…</b></p>
      <div class="vote-btns">
        <button class="btn ${v.myVote === true ? 'btn-primary' : ''}" data-act="vote" data-accept="1">Expulsar</button>
        <button class="btn ${v.myVote === false ? 'btn-primary' : ''}" data-act="vote" data-accept="0">Que se quede</button>
      </div>
    </div>`;
  }

  function tickCountdowns() {
    document.querySelectorAll('[data-until]').forEach((el) => {
      const s = Math.max(0, Math.ceil((Number(el.dataset.until) - C.serverNow()) / 1000));
      el.textContent = s + ' s';
    });
  }
  setInterval(tickCountdowns, 1000);

  // ---------- Eventos ----------
  async function act(res) {
    const r = await res;
    if (r && !r.ok) C.toast(r.error || 'No se pudo hacer eso', 'err');
    return r;
  }
  const gameAct = (action, payload) => act(C.emit('game:action', { action, payload }));

  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const d = el.dataset;
    const g = C.state && C.state.game;
    switch (d.act) {
      case 'create':
        e.preventDefault();
        return enterRoom('create');
      case 'join':
        return enterRoom('join');
      case 'close-alert':
        return C.closeAlert();
      case 'copy-link':
      case 'share': {
        const url = `${location.origin}${location.pathname}?room=${C.state.room.code}`;
        const text = `Únete a mi mesa en El Curao del Vera. Código ${C.state.room.code}`;
        if (d.act === 'share' && navigator.share) {
          try {
            return await navigator.share({ title: 'El Curao del Vera', text, url });
          } catch (_) {
            return;
          }
        }
        try {
          await navigator.clipboard.writeText(url);
          C.toast('Enlace copiado. Pégalo en el grupo');
        } catch (_) {
          C.toast(`Enlace: ${url}`);
        }
        return;
      }
      case 'leave':
        if (!confirm('¿Salir de la sala? Pierdes tu asiento y tus tragos acumulados.')) return;
        await C.emit('room:leave', {});
        C.session.clear();
        return goHome();
      case 'start': {
        const type = d.type;
        const opts = {};
        const def = GAMES.find((x) => x.type === type);
        def.opts.forEach((o) => (opts[o.key] = (C.ui.opts[type] || {})[o.key] ?? o.def));
        return act(C.emit('game:start', { type, options: opts }));
      }
      case 'stop':
        if (!confirm('¿Terminar el juego actual? Los tragos acumulados se mantienen.')) return;
        return act(C.emit('game:stop', {}));
      // Poker
      case 'poker':
        return gameAct(d.a, d.a === 'raise' ? { amount: C.ui.raiseTo } : {});
      case 'poker-next':
        return gameAct('nextHand');
      case 'raise-step': {
        C.ui.raiseTo += Number(d.d);
        return render();
      }
      case 'raise-set': {
        const y = g.you;
        const v = d.v === 'min' ? y.minRaiseTo : d.v === 'half' ? g.currentBet + Math.ceil(g.pot / 2) : g.currentBet + g.pot;
        C.ui.raiseTo = v;
        return render();
      }
      // Pirámide
      case 'pir-reveal':
        return gameAct('reveal');
      case 'pir-claim':
        return gameAct('claim');
      // Mayor o menor
      case 'mm':
        return gameAct('guess', { guess: d.g });
      // Tragos
      case 'drink': {
        const me = C.state.room.players.find((p) => p.id === C.state.room.you);
        return act(C.emit('drinks:drink', { amount: d.n === 'all' ? me.pendientes : 1 }));
      }
      case 'give-step': {
        const me = C.state.room.players.find((p) => p.id === C.state.room.you);
        C.ui.giveAmt = d.d === 'all' ? me.repartir : C.ui.giveAmt + Number(d.d);
        return renderMyBar(C.state.room, me);
      }
      case 'give': {
        const r = await act(C.emit('drinks:give', { to: d.to, amount: C.ui.giveAmt }));
        if (r && r.ok) C.toast(`Repartiste ${t(C.ui.giveAmt)} a ${C.nameOf(d.to)}`);
        return;
      }
      // Expulsión
      case 'kick':
        return act(C.emit('kick:start', { target: d.target }));
      case 'vote':
        return act(C.emit('kick:vote', { voteId: C.state.room.vote.id, accept: d.accept === '1' }));
    }
  });

  document.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-opt]');
    if (!sel) return;
    const [type, key] = sel.dataset.opt.split('.');
    (C.ui.opts[type] = C.ui.opts[type] || {})[key] = Number(sel.value);
  });

  $('form-home').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = $('in-code').value.trim();
    enterRoom(code.length === 4 && document.activeElement === $('in-code') ? 'join' : 'create');
  });

  // Pulso de actividad: avisa al servidor que sigues en la pantalla (para detectar inactivos)
  let lastPing = 0;
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) =>
    document.addEventListener(
      ev,
      () => {
        const now = Date.now();
        if (now - lastPing > 8000 && C.socket && C.socket.connected && C.state) {
          lastPing = now;
          C.socket.emit('activity');
        }
      },
      { passive: true }
    )
  );

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && C.socket && !C.socket.connected) C.socket.connect();
  });

  // ---------- Inicio de la app ----------
  $('in-name').value = C.session.lastName();
  if (roomParam) {
    $('in-code').value = roomParam;
    const inv = $('home-invite');
    inv.textContent = `Te invitaron a la sala ${roomParam}. Pon tu nombre y toca Entrar.`;
    inv.hidden = false;
  }
  $('in-code').addEventListener('input', (e) => (e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '')));
  connect();
})();
