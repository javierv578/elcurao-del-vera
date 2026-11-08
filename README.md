# El Curao del Vera

Hub multijugador en tiempo real de juegos de mesa chilenos para beber.
Frontend 100% estático (GitHub Pages) + backend Node.js / Express / Socket.io (Render).

Juegos incluidos: **Poker de Tragos** (Texas Hold'em), **La Pirámide** y **Mayor o Menor**.

```
/backend            Servidor (Render)
  server.js         Express + Socket.io, eventos y límites de mensajes
  rooms.js          Salas, jugadores, reconexión, tragos y votación de expulsión
  games/
    deck.js         Mazo con barajado criptográfico
    handEval.js     Evaluador de manos de poker (mejor 5 de 7)
    poker.js        Texas Hold'em con tragos, botes laterales y All-In
    piramide.js     La Pirámide
    mayormenor.js   Mayor o Menor
  test/smoke.js     Prueba automática con 3 clientes reales
/docs               Frontend (GitHub Pages)
  index.html, css/style.css
  js/config.js      <- aquí va la URL de tu backend
  js/core.js, js/app.js, js/games/*.js
```

## Probar en local

```bash
cd backend
npm install
npm start            # http://localhost:3000 (sirve también el frontend de /docs)
npm test             # prueba de humo
```

Abre `http://localhost:3000` en dos pestañas (o dos celulares en la misma red), crea una sala en una y entra con el código en la otra.

## Desplegar el backend en Render

1. Sube el repo a GitHub.
2. En Render: **New → Web Service**, elige el repo.
   - Root Directory: `backend`
   - Build Command: `npm install`
   - Start Command: `npm start`
3. Variable de entorno: `ALLOWED_ORIGINS=https://TU-USUARIO.github.io` (separa varios con comas). Sin esta variable el servidor acepta cualquier origen.
4. Copia la URL que te da Render (ej. `https://curao-del-vera.onrender.com`).

Notas:
- El plan gratuito de Render duerme el servicio tras ~15 minutos sin tráfico; la primera visita puede tardar cerca de un minuto. El frontend muestra un aviso y reintenta solo.
- Las salas viven en memoria. Si Render reinicia el servicio, se pierden las salas y los jugadores deben crear una nueva.
- `/health` responde `{ok:true}`; úsalo para un monitor externo si quieres mantenerlo despierto.

## Desplegar el frontend en GitHub Pages

1. Edita `docs/js/config.js` y pon la URL de Render en `SERVER_URL`.
2. En GitHub: **Settings → Pages → Deploy from a branch**, rama `main`, carpeta `/docs`.
3. Comparte `https://TU-USUARIO.github.io/TU-REPO/` o el enlace directo a una sala: `...?room=ABCD`.

Para probar sin editar el archivo, también funciona `?server=https://tu-servicio.onrender.com` en la URL (solo fuera de localhost).

## Cómo funciona

**Servidor como única fuente de la verdad.** Las barajas, los turnos y la mesa viven solo en el backend. Cada jugador recibe una vista propia (`state`): sus cartas y las comunitarias. Las cartas ajenas llegan como `null` hasta el showdown, y el mazo nunca se envía. En La Pirámide, el servidor valida cada "la tengo" contra la mano real.

**Salas.** Código de 4 letras (sin I ni O) o enlace `?room=ABCD`. Máximo 8 jugadores. El primero es el anfitrión; si se desconecta, el cargo pasa al siguiente conectado.

**Tragos.** Cada jugador tiene dos contadores visibles en todo momento: 🍺 *acumulados por tomar* y 🎁 *disponibles para repartir*. Quien gana tragos los reparte desde su panel "Mis tragos"; quien recibe uno lo marca como tomado.

**Reglas de cada juego**

- *Poker de Tragos.* Cada mano entra con una bolsa de tragos (configurable). Las apuestas van al pozo; los ganadores reciben lo que ganaron por encima de lo que pusieron como tragos para repartir. Incluye ciegas, botes laterales, empates y subidas mínimas. Un **All-In** lanza una alerta a pantalla completa para toda la sala: la apuesta es *"Vaso lleno a fondo (¡al seco!)"*. Si lo pierde, se avisa de nuevo.
- *La Pirámide.* El servidor reparte la mano privada y arma la pirámide boca abajo. El anfitrión destapa una carta a la vez, de la fila de abajo hacia la punta (la fila de abajo vale 1 trago por carta; la punta vale tantos como filas). Quien tenga el número lo reclama y reparte (coincidencias × valor). Lo que no reparte antes de la siguiente carta se pierde.
- *Mayor o Menor.* Una carta al centro y el jugador en turno canta mayor, menor o igual (el As es la más alta). Acertar mayor/menor sube el pozo de errores en 1 (tope 10). Fallar, incluso porque salió igual, te lleva el pozo completo como tragos por tomar. Cantar igual y acertar reparte el doble del pozo.

**Desconexiones.** Al entrar, el navegador guarda en `localStorage` un token por jugador. Si se cierra la pestaña o se cae internet, el servidor conserva el asiento, las cartas y los tragos. Al volver, el cliente reanuda con el token y queda exactamente donde estaba. También se puede recuperar el asiento entrando con el mismo nombre.

**Expulsar jugador.** El botón aparece activo solo sobre alguien desconectado o inactivo (sin actividad por 2 minutos, o 45 segundos con el turno). Se abre una votación de 30 segundos por Socket.io. Si más de la mitad de los jugadores conectados (sin contar al votado) aprueba, el servidor elimina al jugador de la sala, invalida su token y libera el asiento. Si el votado vuelve o toca la pantalla, la votación se cancela.

## Agregar un juego nuevo

1. Crea `backend/games/mijuego.js` con una clase que reciba `(ctx, playerIds, opts)` e implemente `handle(pid, action, payload)`, `view(pid)`, `has(id)`, `addPlayer(id)`, `removePlayer(id)`, `currentActor()` y `destroy()`. El `ctx` ofrece `addPending`, `addToGive`, `log`, `alert`, `update`, `name` e `isHost`.
2. Regístralo en `GAME_TYPES` (`backend/rooms.js`).
3. Crea `docs/js/games/mijuego.js` con `Curao.games.mijuego = { render(view, room) { return html; } }`, súmalo en `index.html` y en la lista `GAMES` de `app.js`.

## Límites conocidos

- Estado en memoria: sin base de datos, una sola instancia del servidor.
- El juego es una excusa para pasarlo bien: nadie está obligado a beber, se puede cambiar por agua, y no se maneja después de tomar.
