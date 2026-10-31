import { DiscordSDK } from '@discord/embedded-app-sdk';
import { COLORS, COLOR_HEX, FINISHED, tokenCenter } from '../shared/board.js';
import { BoardRenderer } from './renderer.js';

const params = new URLSearchParams(location.search);
const inDiscord = params.has('frame_id');
// Inside Discord every request to our server goes through Discord's proxy.
const BASE = inDiscord ? '/.proxy' : '';
const STEP_MS = 150;

const $ = (id) => document.getElementById(id);
const els = {
  loading: $('loading'),
  loadingText: $('loading-text'),
  game: $('game'),
  canvas: $('board'),
  banner: $('banner'),
  phaseTag: $('phase-tag'),
  seats: $('seats'),
  lobbyControls: $('lobby-controls'),
  startBtn: $('start-btn'),
  lobbyHint: $('lobby-hint'),
  playControls: $('play-controls'),
  dice: $('dice'),
  turnText: $('turn-text'),
  timerBar: $('timer-bar'),
  finishControls: $('finish-controls'),
  againBtn: $('again-btn'),
  log: $('log'),
  toast: $('toast'),
};

const renderer = new BoardRenderer(els.canvas);

let ws = null;
let hello = null;
let me = null;
let state = null;
let clockOffset = 0;
let displayTokens = null; // what the board currently shows (lags behind state while animating)
let anim = null;
let lastAnimatedSeq = 0;
let lastDiceSeq = 0;
let diceRollingUntil = 0;
let reconnectDelay = 500;

// ---------------- startup ----------------

async function main() {
  try {
    const config = await fetch(`${BASE}/api/config`).then((r) => r.json());
    if (inDiscord) {
      hello = await discordLogin(config.clientId);
    } else {
      hello = guestLogin();
    }
    connect();
  } catch (err) {
    console.error(err);
    els.loadingText.textContent = `Couldn't start: ${err.message}`;
  }
}

async function discordLogin(clientId) {
  setLoading('Talking to Discord…');
  const sdk = new DiscordSDK(clientId);
  await sdk.ready();
  const { code } = await sdk.commands.authorize({
    client_id: clientId,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify'],
  });
  const res = await fetch(`${BASE}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error('Login failed');
  const { access_token } = await res.json();
  await sdk.commands.authenticate({ access_token });
  return { type: 'hello', accessToken: access_token, instanceId: sdk.instanceId };
}

function guestLogin() {
  let id = null;
  try {
    id = sessionStorage.getItem('ludo-guest-id');
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem('ludo-guest-id', id);
    }
  } catch {
    id = crypto.randomUUID();
  }
  const name = params.get('name') || `Guest ${id.slice(0, 4).toUpperCase()}`;
  return { type: 'hello', guestId: id, guestName: name, instanceId: params.get('room') || 'local' };
}

function connect() {
  setLoading(state ? 'Reconnecting…' : 'Joining game…');
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}${BASE}/ws`);
  ws.onopen = () => {
    reconnectDelay = 500;
    ws.send(JSON.stringify(hello));
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'welcome') me = msg.you;
    else if (msg.type === 'state') onState(msg.state);
    else if (msg.type === 'error') toast(msg.message);
  };
  ws.onclose = () => {
    els.loading.classList.remove('hidden');
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 8000);
  };
}

function send(action, extra = {}) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'action', action, ...extra }));
}

// ---------------- state handling ----------------

function onState(next) {
  const prev = state;
  state = next;
  clockOffset = next.serverNow - Date.now();
  els.loading.classList.add('hidden');
  els.game.classList.remove('hidden');

  const lm = next.lastMove;
  if (prev && lm && lm.seq > lastAnimatedSeq && displayTokens) {
    // Finish any running animation, then animate this move from the old positions.
    const base = anim ? anim.finalTokens : displayTokens;
    const startTokens = base.map((row) => row.slice());
    const steps = [];
    if (lm.from < 0) steps.push(0);
    else for (let p = lm.from + 1; p <= lm.to; p++) steps.push(p);
    anim = { move: lm, steps, start: performance.now(), startTokens, finalTokens: next.tokens };
    displayTokens = startTokens;
  } else if (!anim) {
    displayTokens = next.tokens;
  } else {
    anim.finalTokens = next.tokens;
  }
  if (lm) lastAnimatedSeq = Math.max(lastAnimatedSeq, lm.seq);

  // Dice roll animation when a fresh roll arrives
  if (next.rolled && next.dice && !next.lastMove && next.seq !== lastDiceSeq) {
    lastDiceSeq = next.seq;
    diceRollingUntil = performance.now() + 450;
    els.dice.classList.remove('rolling');
    void els.dice.offsetWidth;
    els.dice.classList.add('rolling');
  }

  renderUI();
}

function mySeat() {
  if (!state || !me) return -1;
  return state.seats.findIndex((s) => s && !s.bot && s.userId === me.id);
}

function isHost() {
  return state && me && state.hostId === me.id;
}

// ---------------- UI ----------------

function renderUI() {
  const seat = mySeat();
  const { phase } = state;
  els.phaseTag.textContent = phase === 'lobby' ? 'Lobby' : phase === 'playing' ? 'In game' : 'Game over';

  // Seats
  els.seats.innerHTML = '';
  state.seats.forEach((s, i) => {
    const card = document.createElement('div');
    card.className = 'seat';
    card.style.setProperty('--seat-color', COLOR_HEX[COLORS[i]]);
    if (phase === 'playing' && state.turn === i) card.classList.add('turn');
    if (s && !s.bot && me && s.userId === me.id) card.classList.add('me');
    if (s && !s.connected) card.classList.add('offline');

    const top = document.createElement('div');
    top.className = 'seat-top';
    top.innerHTML = `<span class="seat-dot"></span><span class="seat-name"></span>`;
    top.querySelector('.seat-name').textContent = s ? s.name : capitalize(COLORS[i]);
    card.appendChild(top);

    const sub = document.createElement('div');
    sub.className = 'seat-sub';
    if (!s) sub.textContent = 'Empty seat';
    else if (phase === 'lobby') sub.textContent = s.bot ? 'Bot' : s.userId === state.hostId ? 'Host' : 'Ready';
    else {
      const home = state.tokens[i].filter((p) => p >= FINISHED).length;
      const place = state.winners.indexOf(i);
      sub.textContent =
        place >= 0 ? `🏆 ${ordinal(place + 1)} place` : `${home}/4 home${s.connected ? '' : ' · offline (auto)'}`;
    }
    card.appendChild(sub);

    if (phase === 'lobby') {
      const actions = document.createElement('div');
      actions.className = 'seat-actions';
      if (!s) {
        actions.appendChild(button(seat >= 0 ? 'Switch' : 'Sit', () => send('sit', { seat: i })));
        if (isHost()) actions.appendChild(button('+ Bot', () => send('addBot', { seat: i })));
      } else if (seat === i) {
        actions.appendChild(button('Leave', () => send('stand')));
      } else if (isHost()) {
        actions.appendChild(button(s.bot ? 'Remove' : 'Kick', () => send('removeSeat', { seat: i })));
      }
      card.appendChild(actions);
    }
    els.seats.appendChild(card);
  });

  // Controls
  els.lobbyControls.classList.toggle('hidden', phase !== 'lobby');
  els.playControls.classList.toggle('hidden', phase !== 'playing');
  els.finishControls.classList.toggle('hidden', phase !== 'finished' || !isHost());

  if (phase === 'lobby') {
    const count = state.seats.filter(Boolean).length;
    els.startBtn.classList.toggle('hidden', !isHost());
    els.startBtn.disabled = count < 2;
    const hostName = state.seats.find((s) => s && s.userId === state.hostId)?.name;
    if (isHost()) {
      els.lobbyHint.textContent =
        count < 2 ? 'Pick a seat, then wait for friends or add a bot.' : `${count} players ready.`;
    } else {
      els.lobbyHint.textContent = seat < 0 ? 'Pick a seat to join.' : `Waiting for ${hostName || 'the host'} to start…`;
    }
  }

  if (phase === 'playing') {
    const cur = state.seats[state.turn];
    const myTurn = seat === state.turn;
    els.dice.style.setProperty('--glow', COLOR_HEX[COLORS[state.turn]]);
    if (myTurn && !state.rolled) els.turnText.textContent = 'Your turn — roll!';
    else if (myTurn && state.movable.length) els.turnText.textContent = 'Tap a glowing token';
    else if (myTurn) els.turnText.textContent = 'No moves this time';
    else els.turnText.textContent = `${cur.name}'s turn`;
    els.turnText.style.color = COLOR_HEX[COLORS[state.turn]];
    els.dice.disabled = !(myTurn && !state.rolled);
    els.dice.classList.toggle('ready', myTurn && !state.rolled);
  }

  if (phase === 'finished') {
    const lines = state.winners.map((s, i) => `${['🥇', '🥈', '🥉', '4️⃣'][i]} ${state.seats[s]?.name}`);
    els.banner.innerHTML = `Game over!<br>${lines.map(escapeHtml).join('<br>')}`;
    els.banner.classList.remove('hidden');
  } else {
    els.banner.classList.add('hidden');
  }

  els.log.innerHTML = '';
  for (const line of [...state.log].reverse()) {
    const li = document.createElement('li');
    li.textContent = line;
    els.log.appendChild(li);
  }
}

function renderDice(value) {
  const layouts = {
    1: [5],
    2: [1, 9],
    3: [1, 5, 9],
    4: [1, 3, 7, 9],
    5: [1, 3, 5, 7, 9],
    6: [1, 3, 4, 6, 7, 9],
  };
  const key = value || 0;
  if (els.dice.dataset.value === String(key)) return;
  els.dice.dataset.value = String(key);
  els.dice.innerHTML = '';
  if (!value) {
    els.dice.innerHTML = '<span style="grid-area:1/1/4/4;place-self:center;font-weight:800;color:#222;font-size:22px">?</span>';
    return;
  }
  for (const pos of layouts[value]) {
    const pip = document.createElement('span');
    pip.className = 'pip';
    pip.style.gridArea = `${Math.ceil(pos / 3)} / ${((pos - 1) % 3) + 1}`;
    els.dice.appendChild(pip);
  }
}

// ---------------- frame loop ----------------

function frame(now) {
  requestAnimationFrame(frame);
  if (!state) return;

  const wrap = els.canvas.parentElement.getBoundingClientRect();
  renderer.resize(Math.max(200, Math.min(wrap.width, wrap.height)));

  let override = null;
  if (anim) {
    const elapsed = Math.max(0, now - anim.start);
    const i = Math.floor(elapsed / STEP_MS);
    if (i >= anim.steps.length) {
      displayTokens = anim.finalTokens;
      anim = null;
    } else {
      const { seat, token } = anim.move;
      const fromP = i === 0 ? anim.move.from : anim.steps[i - 1];
      const toP = anim.steps[i];
      const t = (elapsed % STEP_MS) / STEP_MS;
      override = { seat, token, progress: toP, point: hop(seat, token, fromP, toP, t) };
    }
  }

  const seat = mySeat();
  const canMove = state.phase === 'playing' && seat === state.turn && state.rolled && !anim && now > diceRollingUntil;
  const active = new Set(state.seats.map((s, i) => (s ? i : -1)).filter((i) => i >= 0));
  if (state.phase === 'lobby') for (let i = 0; i < 4; i++) active.add(i);

  renderer.draw(
    {
      tokens: displayTokens,
      active,
      override,
      highlight: canMove ? { seat, tokens: state.movable } : null,
      turn: state.phase === 'playing' ? state.turn : null,
    },
    now,
  );

  // Dice face (random faces while "rolling")
  if (now < diceRollingUntil) renderDice(1 + Math.floor((now / 70) % 6));
  else renderDice(state.phase === 'playing' ? state.dice : null);

  // Turn timer
  if (state.phase === 'playing' && state.turnDeadline) {
    const left = state.turnDeadline - (Date.now() + clockOffset);
    const pct = Math.max(0, Math.min(1, left / state.turnTimeout));
    els.timerBar.style.width = `${pct * 100}%`;
    els.timerBar.style.background = COLOR_HEX[COLORS[state.turn]];
  }
}

// Interpolates between two squares with a little hop.
function hop(seat, token, fromP, toP, t) {
  const a = centerOf(seat, fromP, token);
  const b = centerOf(seat, toP, token);
  const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  const y = a[0] + (b[0] - a[0]) * ease - Math.sin(Math.PI * t) * 0.35;
  const x = a[1] + (b[1] - a[1]) * ease;
  return [y, x];
}

const centerOf = (seat, p, t) => tokenCenter(seat, p, t);

// ---------------- input ----------------

els.dice.addEventListener('click', () => send('roll'));
els.startBtn.addEventListener('click', () => send('start'));
els.againBtn.addEventListener('click', () => send('newGame'));

els.canvas.addEventListener('pointerdown', (e) => {
  if (!state || state.phase !== 'playing' || anim) return;
  const seat = mySeat();
  if (seat !== state.turn || !state.rolled) return;
  const token = renderer.hitTest(e.clientX, e.clientY, seat, state.movable);
  if (token !== null) send('move', { token });
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && state?.phase === 'playing' && mySeat() === state.turn && !state.rolled) {
    e.preventDefault();
    send('roll');
  }
});

// ---------------- helpers ----------------

function setLoading(text) {
  els.loadingText.textContent = text;
}

let toastTimer = null;
function toast(text) {
  els.toast.textContent = text;
  els.toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 2500);
}

function button(label, onClick) {
  const b = document.createElement('button');
  b.className = 'btn small';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function capitalize(s) {
  return s[0].toUpperCase() + s.slice(1);
}

function ordinal(n) {
  return ['1st', '2nd', '3rd', '4th'][n - 1];
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Used by automated browser tests: screen position of a token you can move right now.
window.__ludoMovablePoint = () => {
  const seat = mySeat();
  if (!state || seat !== state.turn || !state.rolled || anim || !renderer.lastLayout) return null;
  const p = renderer.lastLayout.find((it) => it.seat === seat && state.movable.includes(it.token));
  if (!p) return null;
  const rect = els.canvas.getBoundingClientRect();
  return { x: rect.left + p.x * renderer.cell, y: rect.top + p.y * renderer.cell };
};

requestAnimationFrame(frame);
main();
