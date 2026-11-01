import { DiscordSDK } from '@discord/embedded-app-sdk';
import { MODES, boardFor } from '../shared/board.js';
import { SHOP_ITEMS, ownsItem } from '../shared/shop.js';
import { BoardRenderer, SPIN_MS, LEAVE_MS, EMOTE_MS } from './renderer.js';
import { renderShop } from './shop-ui.js';
import { playerColor } from './skins.js';

const params = new URLSearchParams(location.search);
const inDiscord = params.has('frame_id');
// Inside Discord every request to our server goes through Discord's proxy.
const BASE = inDiscord ? '/.proxy' : '';
const STEP_MS = 170; // one square of movement
const EXIT_MS = 450; // jumping out of base
const CAPTURE_MS = 650; // a captured token flying home
const HOLD_MS = 350; // how long a landed dice stays readable before the move plays
const MAX_QUEUE = 6; // further behind than this, skip animations to catch up
const MEDALS = ['🥇', '🥈', '🥉'];

const $ = (id) => document.getElementById(id);
const els = {
  loading: $('loading'),
  loadingText: $('loading-text'),
  screens: { menu: $('menu'), shop: $('shop'), howto: $('howto'), game: $('game') },
  menuName: $('menu-name'),
  menuStatus: $('menu-status'),
  gameTitle: $('game-title'),
  gameMode: $('game-mode'),
  gamePlayers: $('game-players'),
  playBtn: $('play-btn'),
  newGameBtn: $('new-game-btn'),
  surrenderBtn: $('surrender-btn'),
  shopTabs: $('shop-tabs'),
  shopGrid: $('shop-grid'),
  coins: [...document.querySelectorAll('.coins')],
  canvas: $('board'),
  banner: $('banner'),
  turnPop: $('turn-pop'),
  phaseTag: $('phase-tag'),
  modePicker: $('mode-picker'),
  seats: $('seats'),
  lobbyControls: $('lobby-controls'),
  fillBtn: $('fill-btn'),
  startBtn: $('start-btn'),
  lobbyHint: $('lobby-hint'),
  playControls: $('play-controls'),
  turnText: $('turn-text'),
  timerBar: $('timer-bar'),
  finishControls: $('finish-controls'),
  againBtn: $('again-btn'),
  emoteBar: $('emote-bar'),
  log: $('log'),
  toast: $('toast'),
};

const renderer = new BoardRenderer(els.canvas);

let ws = null;
let hello = null;
let me = null;
let profile = null;
let state = null;
let clockOffset = 0;
let reconnectDelay = 500;
let screen = 'loading';
let shopTab = 'token';
let freeShop = false; // server is in testing mode: everything costs 0

// Server updates become a queue of rolls and moves that play one at a time,
// so nothing is skipped when several arrive close together.
let events = [];
let current = null;
let shownTokens = null; // board after the last finished animation
let latestTokens = null; // board in the latest server update
let lastRollSeq = 0;
let lastMoveSeq = 0;
let lastEmoteId = 0;
let floaters = []; // emotes rising over the board
let dice = { mode: 'hidden' };
let celebrated = false;
let lastFrame = 0;
// The server state the panel shows. It follows the board: each animation carries the state
// that arrived with (or after) it, and the panel moves on to that state when it finishes.
let view = null;

// ---------------- startup ----------------

async function main() {
  try {
    const config = await fetch(`${BASE}/api/config`).then((r) => r.json());
    freeShop = !!config.freeShop;
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
    else if (msg.type === 'profile') onProfile(msg.profile);
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

function sendShop(op, item) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'shop', op, item }));
}

// ---------------- server updates ----------------

function onProfile(next) {
  const gained = profile && next.coins > profile.coins ? next.coins - profile.coins : 0;
  profile = next;
  if (gained) {
    toast(`+${gained} coins!`, 'ok');
    bumpCoins();
  }
  if (screen === 'shop') drawShop();
  renderUI();
}

function onState(next) {
  const prev = state;
  state = next;
  clockOffset = next.serverNow - Date.now();
  els.loading.classList.add('hidden');
  if (screen === 'loading') showScreen('menu');

  // New board or new game: start fresh. (playing → finished keeps going so the winning move animates.)
  const reset = !prev || prev.mode !== next.mode || (prev.phase !== next.phase && next.phase !== 'finished');
  if (reset) {
    events = [];
    current = null;
    shownTokens = latestTokens = next.tokens;
    lastMoveSeq = next.lastMove?.seq ?? 0;
    lastRollSeq = next.seq;
    dice = { mode: 'hidden' };
    celebrated = false;
    if (next.phase === 'finished') {
      celebrated = true;
      showFinish();
    }
  } else {
    if (next.lastMove && next.lastMove.seq > lastMoveSeq) {
      events.push({ type: 'move', move: next.lastMove, start: latestTokens, final: next.tokens });
      lastMoveSeq = next.lastMove.seq;
    } else if (next.rolled && !next.lastMove && next.seq !== lastRollSeq) {
      events.push({ type: 'roll', seat: next.turn, value: next.dice });
      lastRollSeq = next.seq;
    }
    latestTokens = next.tokens;
  }

  for (const e of next.emotes) {
    if (e.id <= lastEmoteId) continue;
    lastEmoteId = e.id;
    floaters.push({ seat: e.seat, emoji: e.emoji, start: performance.now() });
  }

  // While rolls and moves are still playing out, the panel catches up when the last one ends.
  const waiting = events[events.length - 1] || current;
  if (waiting) waiting.after = next;
  else view = next;
  renderUI();
}

function mySeat() {
  if (!state || !me) return -1;
  return state.seats.findIndex((s) => s && !s.bot && s.userId === me.id);
}

// A player colour ('red', …) as it looks on the current board theme.
function col(name) {
  return playerColor(state.theme, name);
}

function isHost() {
  return state && me && state.hostId === me.id;
}

// ---------------- screens ----------------

function showScreen(name) {
  screen = name;
  for (const [id, el] of Object.entries(els.screens)) el.classList.toggle('hidden', id !== name);
  if (name === 'shop') drawShop();
  renderUI();
}

function drawShop() {
  renderShop(
    { tabs: els.shopTabs, grid: els.shopGrid },
    {
      tab: shopTab,
      profile,
      freeShop,
      onTab: (t) => {
        shopTab = t;
        drawShop();
      },
      onBuy: (item) => {
        if (!freeShop && (profile?.coins ?? 0) < item.price) {
          return toast(`You need ${item.price - profile.coins} more coins`);
        }
        sendShop('buy', item.id);
        toast(`Bought ${item.name}!`, 'ok');
      },
      onEquip: (item) => sendShop('equip', item.id),
    },
  );
}

function renderUI() {
  if (!state) return;
  for (const el of els.coins) el.querySelector('b').textContent = profile ? profile.coins : '…';
  // Draw the menu and panel from the state the board has reached, not the newest one.
  const live = state;
  state = view || live;
  try {
    renderMenu();
    renderPanel();
  } finally {
    state = live;
  }
}

// What the menu's main button does right now.
function menuAction() {
  const seat = mySeat();
  if (state.phase === 'playing') return seat >= 0 ? 'Back to game' : 'Watch game';
  if (state.phase === 'finished') return 'See results';
  if (!state.hostId) return 'Host a game';
  if (seat >= 0) return 'Open lobby';
  const full = state.seatsAllowed.every((i) => state.seats[i]);
  return full ? 'Watch lobby' : 'Join game';
}

function renderMenu() {
  els.menuName.textContent = me ? `Signed in as ${me.name}` : '';
  const board = boardFor(state.mode);
  const hostName = state.people.find((p) => p.id === state.hostId)?.name;

  els.gameTitle.textContent =
    state.phase === 'playing'
      ? 'Game in progress'
      : state.phase === 'finished'
        ? 'Game over'
        : hostName
          ? `${hostName}'s game`
          : 'No game yet';
  els.gameMode.textContent = MODES[state.mode].label;
  els.gameMode.classList.toggle('hidden', state.phase === 'lobby' && !state.hostId);

  // Everyone who has joined, with their colour
  els.gamePlayers.innerHTML = '';
  const joined = state.seatsAllowed.filter((i) => state.seats[i]);
  if (state.phase === 'lobby' && !state.hostId) {
    els.gamePlayers.appendChild(listItem(null, 'Host a game and your friends can join from here.', '', true));
  } else {
    for (const i of joined) {
      const s = state.seats[i];
      const tag = s.userId === state.hostId ? 'Host' : s.bot ? 'Bot' : s.surrendered ? 'Out' : me && s.userId === me.id ? 'You' : '';
      els.gamePlayers.appendChild(listItem(playerColor(state.theme, board.colors[i]), s.name, tag));
    }
    const open = state.seatsAllowed.length - joined.length;
    if (state.phase === 'lobby' && open > 0) {
      els.gamePlayers.appendChild(listItem(null, `${open} open seat${open === 1 ? '' : 's'}`, '', true));
    }
  }

  els.playBtn.textContent = menuAction();
  // A finished game can be reset by anyone; a running one only by the host.
  els.newGameBtn.classList.toggle('hidden', !(state.phase === 'finished' || (state.phase === 'playing' && isHost())));

  const names = state.people.map((p) => p.name);
  els.menuStatus.textContent = `In this activity: ${names.join(', ')}`;
}

function listItem(color, text, tag, muted = false) {
  const li = document.createElement('li');
  if (muted) li.className = 'muted';
  if (color) {
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = color;
    li.appendChild(dot);
  }
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = text;
  li.appendChild(name);
  if (tag) {
    const t = document.createElement('span');
    t.className = 'tag';
    t.textContent = tag;
    li.appendChild(t);
  }
  return li;
}

function renderPanel() {
  const seat = mySeat();
  const { phase } = state;
  const board = boardFor(state.mode);
  els.phaseTag.textContent =
    phase === 'lobby' ? `Lobby · ${MODES[state.mode].label}` : phase === 'playing' ? 'In game' : 'Game over';

  // Mode picker (host only, lobby only)
  els.modePicker.classList.toggle('hidden', phase !== 'lobby');
  const modeKey = `${state.mode}|${isHost()}`;
  if (els.modePicker.dataset.key !== modeKey) {
    els.modePicker.dataset.key = modeKey;
    els.modePicker.innerHTML = '';
    for (const [id, m] of Object.entries(MODES)) {
      const b = button(m.label, () => send('setMode', { mode: id }));
      b.classList.toggle('active', id === state.mode);
      b.disabled = !isHost();
      els.modePicker.appendChild(b);
    }
  }

  // Seats
  els.seats.innerHTML = '';
  els.seats.classList.toggle('six', state.seatsAllowed.length > 4);
  for (const i of state.seatsAllowed) {
    const s = state.seats[i];
    const colorName = board.colors[i];
    const card = document.createElement('div');
    card.className = 'seat';
    card.style.setProperty('--seat-color', col(colorName));
    if (phase === 'playing' && state.turn === i) card.classList.add('turn');
    if (s && !s.bot && me && s.userId === me.id) card.classList.add('me');
    if (s && !s.connected) card.classList.add('offline');

    const top = document.createElement('div');
    top.className = 'seat-top';
    top.innerHTML = `<span class="seat-dot"></span><span class="seat-name"></span>`;
    top.querySelector('.seat-name').textContent = s ? s.name : capitalize(colorName);
    card.appendChild(top);

    const sub = document.createElement('div');
    sub.className = 'seat-sub';
    if (!s) sub.textContent = 'Empty seat';
    else if (phase === 'lobby') sub.textContent = s.bot ? 'Bot' : s.userId === state.hostId ? 'Host' : 'Ready';
    else if (s.surrendered) sub.textContent = '🏳️ Surrendered';
    else {
      const home = state.tokens[i].filter((p) => p >= board.finished).length;
      const place = state.winners.indexOf(i);
      const missed = state.timeouts?.[i] || 0;
      sub.textContent =
        place >= 0
          ? `🏆 ${ordinal(place + 1)} place`
          : `${home}/4 home${s.connected ? '' : ' · offline (auto)'}${missed ? ` · ⏰ ${missed}/${state.maxTimeouts}` : ''}`;
    }
    card.appendChild(sub);

    if (phase === 'lobby' && state.hostId) {
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
  }

  // Controls
  els.lobbyControls.classList.toggle('hidden', phase !== 'lobby');
  els.playControls.classList.toggle('hidden', phase !== 'playing');
  els.finishControls.classList.toggle('hidden', phase !== 'finished');

  if (phase === 'lobby') {
    const count = state.seats.filter(Boolean).length;
    const empty = state.seatsAllowed.some((i) => !state.seats[i]);
    els.startBtn.classList.toggle('hidden', !isHost());
    els.fillBtn.classList.toggle('hidden', !isHost() || !empty);
    els.startBtn.disabled = count < 2;
    const hostName = state.seats.find((s) => s && s.userId === state.hostId)?.name;
    if (!state.hostId) {
      els.lobbyHint.textContent = 'Nobody is hosting yet. Go back to the menu to host a game.';
    } else if (isHost()) {
      els.lobbyHint.textContent =
        count < 2 ? 'Pick a seat, then wait for friends or add a bot.' : `${count} players ready.`;
    } else {
      els.lobbyHint.textContent = seat < 0 ? 'Pick a seat to join.' : `Waiting for ${hostName || 'the host'} to start…`;
    }
  }

  if (phase === 'playing') {
    const cur = state.seats[state.turn];
    const myTurn = seat === state.turn;
    if (myTurn && !state.rolled) els.turnText.textContent = 'Your turn — tap the dice!';
    else if (myTurn && new Set(state.movable.map((t) => state.tokens[seat][t])).size === 1)
      els.turnText.textContent = `You rolled a ${state.dice} — moving your token…`; // the server moves it
    else if (myTurn && state.movable.length) els.turnText.textContent = `You rolled a ${state.dice} — tap a glowing token`;
    else if (myTurn) els.turnText.textContent = `You rolled a ${state.dice} — no moves this time`;
    else if (state.rolled) els.turnText.textContent = `${cur.name} rolled a ${state.dice}`;
    else els.turnText.textContent = `${cur.name}'s turn`;
    els.turnText.style.color = col(board.colors[state.turn]);
    const racing = seat >= 0 && !state.seats[seat].surrendered && !state.winners.includes(seat);
    els.surrenderBtn.classList.toggle('hidden', !racing);
  }

  if (phase !== 'finished') els.banner.classList.add('hidden');

  // Emotes you own (only once you're seated)
  const owned = SHOP_ITEMS.filter((i) => i.type === 'emote' && ownsItem(profile, i.id));
  const emoteKey = seat >= 0 ? owned.map((i) => i.id).join() : '';
  if (els.emoteBar.dataset.key !== emoteKey) {
    els.emoteBar.dataset.key = emoteKey;
    els.emoteBar.innerHTML = '';
    if (emoteKey) {
      for (const item of owned) {
        const b = document.createElement('button');
        b.className = 'emote';
        b.title = item.name;
        b.textContent = item.emoji;
        b.addEventListener('click', () => send('emote', { item: item.id }));
        els.emoteBar.appendChild(b);
      }
    }
  }

  els.log.innerHTML = '';
  for (const line of [...state.log].reverse()) {
    const li = document.createElement('li');
    li.textContent = line;
    els.log.appendChild(li);
  }
}

function showFinish() {
  const lines = state.winners.map((s, i) => {
    const coins = state.rewards?.[s];
    const reward = coins ? ` <span class="reward">+${coins} 🪙</span>` : '';
    return `${MEDALS[i] || `${i + 1}.`} ${escapeHtml(state.seats[s]?.name)}${reward}`;
  });
  els.banner.innerHTML = `<div class="banner-title">Game over!</div>${lines.join('<br>')}`;
  els.banner.classList.remove('hidden');
}

// ---------------- animation ----------------

const idle = () => !current && events.length === 0;

function stepAnimations(now, dt) {
  if (events.length > MAX_QUEUE) skipAnimations();
  // Leave a landed dice on screen long enough to read before the move plays.
  const holding =
    events[0]?.type === 'move' && dice.mode === 'shown' && now - dice.t0 < HOLD_MS && events.length < 3;
  if (!current && events.length && !holding) startEvent(events.shift(), now);
  if (current) {
    current.elapsed += dt * (events.length >= 2 ? 2 : 1); // hurry when falling behind
    if (current.type === 'move') current.overrides = moveOverrides(current);
    if (current.elapsed >= current.duration) endEvent(current, now);
  }
  updateDice(now);
  // Changes that aren't moves (e.g. a surrender clears that player's pawns) show once nothing is animating.
  if (idle()) {
    shownTokens = latestTokens;
    if (view !== state) {
      view = state;
      renderUI();
    }
  }

  if (state.phase === 'finished' && idle() && !celebrated) {
    celebrated = true;
    showFinish();
    renderer.confetti(state.winners.slice(0, 3).map((s) => col(boardFor(state.mode).colors[s])).concat('#ffffff', '#f6cf57'));
  }
}

function startEvent(ev, now) {
  current = ev;
  ev.elapsed = 0;
  if (ev.type === 'roll') {
    ev.duration = SPIN_MS;
    // A different tumble each roll: 2–3 turns one way, 1–2 the other.
    const axes = [(2 + Math.random()) * (Math.random() < 0.5 ? -1 : 1), 1 + Math.random()];
    dice = { mode: 'spin', seat: ev.seat, value: ev.value, t0: now, axes };
    return;
  }
  const { move } = ev;
  ev.steps = [];
  if (move.from < 0) ev.steps.push(0);
  else for (let p = move.from + 1; p <= move.to; p++) ev.steps.push(p);
  ev.hopMs = move.from < 0 ? EXIT_MS : STEP_MS;
  ev.moveMs = ev.steps.length * ev.hopMs;
  ev.duration = ev.moveMs + (move.captured.length ? CAPTURE_MS : 120);
  ev.lastStep = 0;
  // The dice has done its job: shrink it away.
  if (dice.mode !== 'hidden' && dice.mode !== 'leave') dice = { ...dice, mode: 'leave', t0: now };
}

function endEvent(ev, now) {
  if (ev.type === 'roll') {
    dice = { ...dice, mode: 'shown', t0: now };
    renderer.ring(0, 0, '#ffffff', 1.2);
  } else {
    shownTokens = ev.final;
  }
  current = null;
  // The panel catches up to where the board now is.
  if (ev.after) {
    view = ev.after;
    renderUI();
  }
}

function skipAnimations() {
  events = [];
  current = null;
  shownTokens = latestTokens;
  view = state;
  renderUI();
  dice = state.phase === 'playing' && state.rolled ? { mode: 'shown', seat: state.turn, value: state.dice, t0: 0 } : { mode: 'hidden' };
}

// Where the moving token (and anything it captured) is right now.
function moveOverrides(ev) {
  const board = boardFor(state.mode);
  const { seat, token, captured } = ev.move;
  const color = col(board.colors[seat]);
  const map = new Map();
  const e = ev.elapsed;

  if (e < ev.moveMs) {
    const i = Math.floor(e / ev.hopMs);
    const t = (e % ev.hopMs) / ev.hopMs;
    const fromP = i === 0 ? ev.move.from : ev.steps[i - 1];
    const a = board.tokenCenter(seat, fromP, token);
    const b = board.tokenCenter(seat, ev.steps[i], token);
    if (i !== ev.lastStep) {
      ev.lastStep = i;
      renderer.ring(a.x, a.y, color, 0.45); // little dust ring on each landing
    }
    const k = easeInOut(t);
    map.set(`${seat}-${token}`, {
      x: a.x + (b.x - a.x) * k,
      y: a.y + (b.y - a.y) * k,
      lift: Math.sin(Math.PI * t) * (ev.move.from < 0 ? 1.2 : 0.5),
      squash: i > 0 && t < 0.2 ? 0.82 + 0.9 * t : 1,
    });
    return map;
  }

  const end = board.tokenCenter(seat, ev.move.to, token);
  if (!ev.landed) {
    ev.landed = true;
    renderer.ring(end.x, end.y, color, 0.8);
    if (captured.length) renderer.burst(end.x, end.y, [color, '#ffffff', '#ffd23f'], { count: 22, speed: 5 });
    if (ev.move.finishedToken) renderer.burst(end.x, end.y, [color, '#f6cf57', '#ffffff'], { count: 30, speed: 4, life: 900 });
  }
  const settle = Math.min(1, (e - ev.moveMs) / 160);
  map.set(`${seat}-${token}`, { x: end.x, y: end.y, lift: 0, squash: 0.8 + 0.2 * easeOutBack(settle) });

  // Captured tokens fly back to base.
  const ct = Math.min(1, (e - ev.moveMs) / CAPTURE_MS);
  for (const c of captured) {
    const from = board.tokenCenter(c.seat, ev.start[c.seat][c.token], c.token);
    const to = board.tokenCenter(c.seat, -1, c.token);
    const k = easeInOut(ct);
    map.set(`${c.seat}-${c.token}`, {
      x: from.x + (to.x - from.x) * k,
      y: from.y + (to.y - from.y) * k,
      lift: Math.sin(Math.PI * ct) * 2.5,
      squash: 1,
    });
  }
  return map;
}

// The dice appears for whoever must roll, and leaves once it has been used.
function updateDice(now) {
  if (dice.mode === 'leave' && now - dice.t0 > LEAVE_MS) dice = { mode: 'hidden' };
  if (!idle()) return;
  const leave = () => (dice = { ...dice, mode: 'leave', t0: now });

  if (state.phase !== 'playing') {
    if (dice.mode !== 'hidden' && dice.mode !== 'leave') leave();
    return;
  }
  if (state.rolled) {
    // e.g. joined mid-turn: just show the roll
    if (dice.mode === 'hidden' || dice.mode === 'ready') dice = { mode: 'shown', seat: state.turn, value: state.dice, t0: now };
    return;
  }
  if (dice.mode === 'shown' || (dice.mode === 'ready' && dice.seat !== state.turn)) leave();
  else if (dice.mode === 'hidden') {
    dice = { mode: 'ready', seat: state.turn, t0: now };
    if (state.turn === mySeat()) showTurnPop();
  }
}

function canRoll() {
  return state?.phase === 'playing' && mySeat() === state.turn && !state.rolled && dice.mode === 'ready' && idle();
}

function canMove() {
  return (
    state?.phase === 'playing' &&
    mySeat() === state.turn &&
    state.rolled &&
    state.movable.length > 0 &&
    dice.mode === 'shown' &&
    idle()
  );
}

// ---------------- frame loop ----------------

function frame(now) {
  requestAnimationFrame(frame);
  // Real elapsed time, so the queue keeps up even when frames are slow (e.g. a background tab).
  const dt = lastFrame ? Math.min(1000, now - lastFrame) : 16;
  lastFrame = now;
  if (!state) return;
  stepAnimations(now, dt);
  if (screen !== 'game') return;

  const board = boardFor(state.mode);
  renderer.setBoard(board, state.theme);
  const wrap = els.canvas.parentElement.getBoundingClientRect();
  renderer.resize(Math.max(200, Math.min(wrap.width, wrap.height)));

  const seat = mySeat();
  const active =
    state.phase === 'lobby' ? state.seatsAllowed : state.seats.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
  floaters = floaters.filter((f) => now - f.start < EMOTE_MS);

  renderer.draw(
    {
      tokens: current?.type === 'move' ? current.start : shownTokens,
      active,
      skins: state.seats.map((s) => s?.skins.token),
      overrides: current?.type === 'move' ? current.overrides : null,
      highlight: canMove() ? { seat, tokens: state.movable } : null,
      turn: state.phase === 'playing' ? state.turn : null,
      dice: diceView(now, board),
      emotes: floaters,
    },
    now,
  );

  // Turn timer
  if (state.phase === 'playing' && state.turnDeadline) {
    const left = state.turnDeadline - (Date.now() + clockOffset);
    const pct = Math.max(0, Math.min(1, left / state.turnTimeout));
    els.timerBar.style.width = `${pct * 100}%`;
    els.timerBar.style.background = col(board.colors[state.turn]);
  }
}

function diceView(now, board) {
  if (dice.mode === 'hidden') return null;
  return {
    mode: dice.mode,
    t: now - dice.t0,
    value: dice.value,
    axes: dice.axes,
    style: state.seats[dice.seat]?.skins.dice,
    color: col(board.colors[dice.seat]),
    mine: dice.seat === mySeat(),
  };
}

// ---------------- input ----------------

for (const b of document.querySelectorAll('[data-go]')) b.addEventListener('click', () => showScreen(b.dataset.go));
els.playBtn.addEventListener('click', () => {
  const action = menuAction();
  if (action === 'Host a game') send('host');
  else if (action === 'Join game') send('join');
  showScreen('game');
});
els.startBtn.addEventListener('click', () => send('start'));
els.fillBtn.addEventListener('click', () => send('fillBots'));
els.againBtn.addEventListener('click', () => send('newGame'));
confirmTap(els.surrenderBtn, 'Tap again to surrender', () => send('surrender'));
confirmTap(
  els.newGameBtn,
  'Tap again to end this game',
  () => {
    send('newGame');
    showScreen('game');
  },
  () => state.phase === 'playing', // only ask twice when a game is still running
);

// Buttons that need a second tap within 3 seconds, so they aren't hit by accident.
function confirmTap(btn, confirmLabel, action, needsConfirm = () => true) {
  let timer = null;
  let label = btn.textContent;
  const reset = () => {
    clearTimeout(timer);
    timer = null;
    btn.textContent = label;
    btn.classList.remove('danger');
  };
  btn.addEventListener('click', () => {
    if (timer || !needsConfirm()) {
      reset();
      action();
      return;
    }
    label = btn.textContent;
    btn.textContent = confirmLabel;
    btn.classList.add('danger');
    timer = setTimeout(reset, 3000);
  });
}

els.canvas.addEventListener('pointerdown', (e) => {
  if (canRoll() && renderer.hitDice(e.clientX, e.clientY)) return send('roll');
  if (!canMove()) return;
  const token = renderer.hitToken(e.clientX, e.clientY, mySeat(), state.movable);
  if (token !== null) send('move', { token });
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && screen === 'game' && canRoll()) {
    e.preventDefault();
    send('roll');
  }
});

// ---------------- helpers ----------------

function setLoading(text) {
  els.loadingText.textContent = text;
}

let toastTimer = null;
function toast(text, kind = 'error') {
  els.toast.textContent = text;
  els.toast.className = `toast ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 2500);
}

let popTimer = null;
function showTurnPop() {
  els.turnPop.classList.remove('hidden');
  els.turnPop.style.animation = 'none';
  void els.turnPop.offsetWidth;
  els.turnPop.style.animation = '';
  clearTimeout(popTimer);
  popTimer = setTimeout(() => els.turnPop.classList.add('hidden'), 1300);
}

function bumpCoins() {
  for (const el of els.coins) {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }
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
  return ['1st', '2nd', '3rd', '4th', '5th', '6th'][n - 1];
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

function easeOutBack(k) {
  const c = 1.70158;
  return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2;
}

// Used by automated browser tests: screen positions of things you can tap right now.
window.__ludoMovablePoint = () => {
  if (!canMove() || !renderer.lastLayout) return null;
  const seat = mySeat();
  const p = renderer.lastLayout.find((it) => it.seat === seat && state.movable.includes(it.token));
  return p ? renderer.tokenPoint(p) : null;
};
window.__ludoDicePoint = () => (canRoll() ? renderer.toClient(0, 0) : null);

requestAnimationFrame(frame);
main();
