/* Utilidades compartidas, conexión y sesión. Todo cuelga de window.Curao. */
(function () {
  'use strict';
  const Curao = (window.Curao = { games: {}, state: null, ui: { opts: {}, giveAmt: 1, raiseTo: null, raiseKey: '' }, serverOffset: 0 });

  Curao.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const SUIT = { c: '♣', d: '♦', h: '♥', s: '♠' };
  const RANK = { T: '10' };
  /** Carta: code = "As", "Td"... ; null = boca abajo */
  Curao.card = (code, o = {}) => {
    const cls = ['card'];
    if (o.small) cls.push('card-s');
    if (o.big) cls.push('card-l');
    if (o.hl) cls.push('card-hl');
    if (o.dim) cls.push('card-dim');
    if (!code) return `<span class="${cls.join(' ')} card-back" aria-label="Carta boca abajo"></span>`;
    const r = RANK[code[0]] || code[0];
    const red = code[1] === 'h' || code[1] === 'd';
    return `<span class="${cls.join(' ')} ${red ? 'red' : 'black'}" aria-label="${r} de ${SUIT[code[1]]}"><i>${r}</i><b>${SUIT[code[1]]}</b></span>`;
  };
  Curao.cardText = (code) => (RANK[code[0]] || code[0]) + SUIT[code[1]];

  Curao.nameOf = (id) => {
    const p = Curao.state?.room.players.find((x) => x.id === id);
    return p ? p.name : 'Alguien';
  };
  Curao.serverNow = () => Date.now() + Curao.serverOffset;

  Curao.toast = (text, kind = '') => {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = text;
    document.getElementById('toast-layer').appendChild(el);
    setTimeout(() => el.classList.add('out'), 3200);
    setTimeout(() => el.remove(), 3700);
  };

  // ---------- Alertas a pantalla completa (All-In) ----------
  const alertQueue = [];
  let alertShowing = false;
  Curao.showAlert = (a) => {
    alertQueue.push(a);
    if (!alertShowing) nextAlert();
  };
  function nextAlert() {
    const a = alertQueue.shift();
    const layer = document.getElementById('alert-layer');
    if (!a) {
      alertShowing = false;
      layer.innerHTML = '';
      return;
    }
    alertShowing = true;
    const lost = a.kind === 'all_in_lost';
    layer.innerHTML = `
      <div class="allin ${lost ? 'allin-lost' : ''}" role="alertdialog" aria-live="assertive" aria-label="${Curao.esc(a.title)}">
        <div class="allin-inner">
          <div class="allin-glass" aria-hidden="true">🥃</div>
          <h2>${Curao.esc(a.title)}</h2>
          <p class="allin-who">${Curao.esc(a.text)}</p>
          <p class="allin-pen"><small>La apuesta es</small><b>${Curao.esc(a.penalty)}</b></p>
          <button class="btn btn-light" data-act="close-alert">Entendido</button>
        </div>
      </div>`;
    if (navigator.vibrate) navigator.vibrate([200, 80, 200, 80, 400]);
    clearTimeout(Curao._alertTimer);
    Curao._alertTimer = setTimeout(nextAlert, 7000);
  }
  Curao.closeAlert = () => {
    clearTimeout(Curao._alertTimer);
    nextAlert();
  };

  // ---------- Sesión guardada ----------
  const KEY = 'curao.session';
  Curao.session = {
    get() {
      try {
        return JSON.parse(localStorage.getItem(KEY) || 'null');
      } catch (e) {
        return null;
      }
    },
    set(s) {
      try {
        localStorage.setItem(KEY, JSON.stringify(s));
      } catch (e) {}
    },
    clear() {
      try {
        localStorage.removeItem(KEY);
      } catch (e) {}
    },
    lastName() {
      try {
        return localStorage.getItem('curao.name') || '';
      } catch (e) {
        return '';
      }
    },
    saveName(n) {
      try {
        localStorage.setItem('curao.name', n);
      } catch (e) {}
    },
  };

  // ---------- Conexión ----------
  Curao.serverUrl = () => {
    const h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1') return location.origin;
    const q = new URLSearchParams(location.search).get('server');
    return (q || window.CURAO_CONFIG.SERVER_URL || '').replace(/\/$/, '');
  };

  Curao.emit = (ev, msg) =>
    new Promise((resolve) => {
      if (!Curao.socket || !Curao.socket.connected) return resolve({ ok: false, error: 'Sin conexión con el servidor. Reintentando…' });
      let done = false;
      const t = setTimeout(() => {
        if (!done) resolve({ ok: false, error: 'El servidor no respondió. Intenta otra vez' });
      }, 10000);
      Curao.socket.emit(ev, msg, (res) => {
        done = true;
        clearTimeout(t);
        resolve(res || { ok: false, error: 'Sin respuesta' });
      });
    });
})();
