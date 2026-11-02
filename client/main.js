import { DiscordSDK } from '@discord/embedded-app-sdk';
import { MODES, boardFor } from '../shared/board.js';
import { SHOP_ITEMS, ownsItem } from '../shared/shop.js';
import { BoardRenderer, SPIN_MS, LEAVE_MS, EMOTE_MS, drawDice } from './renderer.js';
import { renderShop } from './shop-ui.js';
import { playerColor, SYMBOLS, isColorBlind, setColorBlind } from './skins.js';
import { unlockAudio, sfx, setMusic, setSound, setVolume, audioSettings } from './audio.js';

const params = new URLSearchParams(location.search);
const inDiscord = params.has('frame_id');
// Inside Discord every request to our server goes through Discord's proxy.
const BASE = inDiscord ? '/.proxy' : '';
const STEP_MS = 170; // one square of movement
const EXIT_MS = 450; // jumping out of base
const CAPTURE_MS = 650; // a captured token flying home
const HOLD_MS = 350; // how long a landed dice stays readable before the move plays
const SIX_HOLD_MS = 700; // how long a kept 6 shows before the dice comes back to roll again
const MAX_QUEUE = 6; // further behind than this, skip animations to catch up
const MEDALS = ['🥇', '🥈', '🥉'];

const $ = (id) => document.getElementById(id);
const els = {
  loading: $('loading'),
  loadingText: $('loading-text'),
  screens: { menu: $('menu'), shop: $('shop'), howto: $('howto'), game: $('game') },
  menuName: $('menu-name'),
  myRoom: $('my-room'),
  myRoomInfo: $('my-room-info'),
  gameTitle: $('game-title'),
  gameMode: $('game-mode'),
  gamePlayers: $('game-players'),
  playBtn: $('play-btn'),
  newGameBtn: $('new-game-btn'),
  leaveBtn: $('leave-btn'),
  createCard: $('create-card'),
  visibilityPicker: $('visibility-picker'),
  visibilityHint: $('visibility-hint'),
  createBtn: $('create-btn'),
  roomsCount: $('rooms-count'),
  codeForm: $('code-form'),
  codeInput: $('code-input'),
  roomList: $('room-list'),
  roomInfo: $('room-info'),
  leaveRoomBtn: $('leave-room-btn'),
  roomSettings: $('room-settings'),
  visibilityNote: $('visibility-note'),
  visibilityBtn: $('visibility-btn'),
  chatToggle: $('chat-toggle'),
  peopleList: $('people-list'),
  surrenderBtn: $('surrender-btn'),
  shopTabs: $('shop-tabs'),
  shopGrid: $('shop-grid'),
  coins: [...document.querySelectorAll('.coins')],
  canvas: $('board'),
  banner: $('banner'),
  turnPop: $('turn-pop'),
  rollChooser: $('roll-chooser'),
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
  chats: [...document.querySelectorAll('[data-chat]')],
  audioToggles: [...document.querySelectorAll('[data-toggle]')],
  volumes: [...document.querySelectorAll('[data-volume]')],
  volumeValues: [...document.querySelectorAll('[data-volume-value]')],
  toast: $('toast'),
};

const renderer = new BoardRenderer(els.canvas);

let ws = null;
let hello = null;
let me = null;
let profile = null;
let state = null; // the room you're in (null when you're not in one)
let roomList = []; // rooms you could join, from the server
let newVisibility = 'public'; // the Public/Private choice for "Create room"
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
let rollKey = ''; // changes with every roll and move: an open roll chooser is then out of date
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
    // After a refresh or a dropped connection, go back to the room we were in
    ws.send(JSON.stringify({ ...hello, rejoin: savedRoom() }));
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'welcome') {
      me = msg.you;
      els.loading.classList.add('hidden');
      if (screen === 'loading') showScreen('menu');
    } else if (msg.type === 'profile') onProfile(msg.profile);
    else if (msg.type === 'rooms') {
      roomList = msg.rooms;
      renderUI();
    } else if (msg.type === 'state') onState(msg.state);
    else if (msg.type === 'left') onLeft(msg.message);
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

// Creating, joining and leaving rooms.
function sendLobby(op, extra = {}) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'lobby', op, ...extra }));
}

// The code of the room we're in, kept for this tab so a refresh can rejoin it.
function savedRoom() {
  try {
    return sessionStorage.getItem('ludo-room') || null;
  } catch {
    return null;
  }
}

function saveRoom(code) {
  try {
    if (code) sessionStorage.setItem('ludo-room', code);
    else sessionStorage.removeItem('ludo-room');
  } catch {
    // not saved: a refresh just goes back to the menu
  }
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

// We left the room (or were removed, or it closed while we were away): back to the menu.
function onLeft(message) {
  saveRoom(null);
  state = view = null;
  events = [];
  current = null;
  dice = { mode: 'hidden' };
  floaters = [];
  closeChooser();
  if (screen === 'game') showScreen('menu');
  else renderUI();
  if (message) toast(message);
}

function onState(next) {
  const prev = state?.roomId === next.roomId ? state : null; // a different room starts from scratch
  state = next;
  clockOffset = next.serverNow - Date.now();
  els.loading.classList.add('hidden');
  saveRoom(next.code);
  if (!prev) {
    // Just created or joined a room: go to it, with a clean chat and no old emotes
    shownChatId = 0;
    chatVersion++;
    lastEmoteId = Math.max(0, ...next.emotes.map((e) => e.id));
    floaters = [];
    closeChooser();
    showScreen('game');
  }

  // New board or new game: start fresh. (playing → finished keeps going so the winning move animates.)
  const reset = !prev || prev.mode !== next.mode || (prev.phase !== next.phase && next.phase !== 'finished');
  if (reset) {
    events = [];
    current = null;
    shownTokens = latestTokens = next.tokens;
    lastMoveSeq = next.lastMove?.seq ?? 0;
    lastRollSeq = next.lastRoll?.seq ?? 0;
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
    }
    if (next.lastRoll && next.lastRoll.seq > lastRollSeq) {
      // 6s already kept this turn stay on show while the next roll tumbles
      const bank = prev.turn === next.turn && !prev.rolled ? prev.rolls || [] : [];
      events.push({ type: 'roll', seat: next.lastRoll.seat, value: next.lastRoll.value, bank });
      lastRollSeq = next.lastRoll.seq;
    }
    latestTokens = next.tokens;
  }
  const key = `${next.phase}:${next.lastRoll?.seq}:${next.lastMove?.seq}`;
  if (key !== rollKey) {
    rollKey = key;
    closeChooser();
  }

  for (const e of next.emotes) {
    if (e.id <= lastEmoteId) continue;
    lastEmoteId = e.id;
    if (muted.has(next.seats[e.seat]?.userId)) continue; // you muted them
    floaters.push({ seat: e.seat, emoji: e.emoji, start: performance.now() });
  }

  // While rolls and moves are still playing out, the panel catches up when the last one ends.
  const waiting = events[events.length - 1] || current;
  if (waiting) waiting.after = next;
  else view = next;
  renderUI();
  renderChat(); // chat is live, it doesn't wait for the board
}

// ---------------- chat ----------------

let shownChatId = 0; // newest message shown (for the chat sound)
let chatVersion = 0; // bumped when the chat must redraw anyway: a new room, a mute, colour-blind mode
let shownChatKey = '';

// People you muted: their chat and emotes are hidden, only for you. Kept on this device.
const muted = new Set(loadMuted());
function loadMuted() {
  try {
    return JSON.parse(localStorage.getItem('ludo-muted') || '[]');
  } catch {
    return [];
  }
}
function toggleMute(userId) {
  if (muted.has(userId)) muted.delete(userId);
  else muted.add(userId);
  try {
    localStorage.setItem('ludo-muted', JSON.stringify([...muted]));
  } catch {
    // not saved: the mute lasts until the page closes
  }
  chatVersion++; // redraw the chat without (or with) them
  renderChat();
  renderUI();
}

function renderChat() {
  if (!state) return;
  // Typed chat can be turned off by the host; emotes still work
  for (const box of els.chats) {
    const input = box.querySelector('input');
    input.disabled = !state.chatOn;
    input.placeholder = state.chatOn ? 'Say something…' : 'The host turned chat off';
  }
  const msgs = (state.chat || []).filter((m) => !muted.has(m.userId));
  const latest = msgs.at(-1)?.id || 0;
  const key = `${chatVersion}|${latest}`;
  if (key === shownChatKey) return;
  shownChatKey = key;
  if (shownChatId && latest > shownChatId && msgs.at(-1).userId !== me?.id) sfx('chat');
  shownChatId = latest;

  const board = boardFor(state.mode);
  for (const box of els.chats) {
    const list = box.querySelector('.chat-log');
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.innerHTML = '';
    if (!msgs.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No messages yet. Say hi!';
      list.appendChild(li);
    }
    for (const m of msgs) {
      const li = document.createElement('li');
      const who = document.createElement('span');
      who.className = 'who';
      // Players' names in their colour (and shape); watchers in the normal text colour
      const seat = state.seats.findIndex((s) => s && !s.bot && s.userId === m.userId);
      who.textContent = (seat >= 0 ? sym(board.colors[seat]) : '') + m.name;
      if (seat >= 0) who.style.color = col(board.colors[seat]);
      li.appendChild(who);
      li.appendChild(document.createTextNode(m.text));
      list.appendChild(li);
    }
    if (atBottom || !list.dataset.seen) list.scrollTop = list.scrollHeight;
    list.dataset.seen = '1';
  }
}

for (const box of els.chats) {
  const form = box.querySelector('form');
  const input = box.querySelector('input');
  // "0/100" beside the box: yellow when nearly full, red at the limit
  const count = document.createElement('span');
  count.className = 'chat-count';
  form.insertBefore(count, form.querySelector('button'));
  const updateCount = () => {
    const n = input.value.length;
    count.textContent = `${n}/${input.maxLength}`;
    count.classList.toggle('near', n >= input.maxLength * 0.8 && n < input.maxLength);
    count.classList.toggle('full', n >= input.maxLength);
  };
  input.addEventListener('input', updateCount);
  updateCount();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    send('chat', { text });
    input.value = '';
    updateCount();
  });
}

// ---------------- sound ----------------

function renderAudioToggles() {
  const s = audioSettings();
  for (const b of els.audioToggles) {
    const on = s[b.dataset.toggle];
    b.textContent = on ? 'On' : 'Off';
    b.classList.toggle('off', !on);
  }
  // The menu and the game panel each have both sliders; keep them in step.
  const pct = (kind) => Math.round(s[kind === 'music' ? 'musicVolume' : 'soundVolume'] * 100);
  for (const input of els.volumes) if (Number(input.value) !== pct(input.dataset.volume)) input.value = pct(input.dataset.volume);
  for (const el of els.volumeValues) el.textContent = `${pct(el.dataset.volumeValue)}%`;
}

for (const input of els.volumes) {
  input.addEventListener('input', () => {
    setVolume(input.dataset.volume, Number(input.value) / 100);
    renderAudioToggles();
  });
  // A tap to hear the new sound level (the music is playing anyway)
  if (input.dataset.volume === 'sound') input.addEventListener('change', () => sfx('step'));
}

for (const b of els.audioToggles) {
  b.addEventListener('click', () => {
    const s = audioSettings();
    if (b.dataset.toggle === 'music') setMusic(!s.music);
    else setSound(!s.sound);
    renderAudioToggles();
  });
}
renderAudioToggles();

// ---------------- colour-blind mode ----------------

const cbButtons = [...document.querySelectorAll('[data-cb]')];
function renderColorBlindToggles() {
  for (const b of cbButtons) {
    b.textContent = isColorBlind() ? 'On' : 'Off';
    b.classList.toggle('off', !isColorBlind());
  }
}
for (const b of cbButtons) {
  b.addEventListener('click', () => {
    setColorBlind(!isColorBlind());
    renderColorBlindToggles();
    // Everything with player colours redraws: the board (next frame), panel, chat and shop
    chatVersion++;
    if (state) {
      renderUI();
      renderChat();
      if (screen === 'shop') drawShop();
    }
  });
}
renderColorBlindToggles();

// Browsers only allow sound after the player interacts with the page.
for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, unlockAudio, { capture: true });

function mySeat() {
  if (!state || !me) return -1;
  return state.seats.findIndex((s) => s && !s.bot && s.userId === me.id);
}

// A player colour ('red', …) as it looks on the current board theme.
function col(name) {
  return playerColor(myTheme(), name);
}

// In colour-blind mode, a player colour's shape to put before a name ('▲ '); otherwise nothing.
function sym(name) {
  return isColorBlind() ? `${SYMBOLS[name]} ` : '';
}

// Board themes are just looks, so everyone sees the one they equipped (watchers without one: the host's).
function myTheme() {
  return profile?.equipped?.board || state?.theme;
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
  for (const el of els.coins) el.querySelector('b').textContent = profile ? profile.coins : '…';
  renderMenu();
  if (!state) return;
  // Draw the panel from the state the board has reached, not the newest one.
  const live = state;
  state = view || live;
  try {
    renderMyRoom();
    renderPanel();
  } finally {
    state = live;
  }
}

// ---------------- menu: create a room, find a room ----------------

function renderMenu() {
  els.menuName.textContent = me ? `Signed in as ${me.name}` : '';
  els.myRoom.classList.toggle('hidden', !state);
  els.createCard.classList.toggle('hidden', !!state); // one room at a time: leave yours to make another

  for (const b of els.visibilityPicker.querySelectorAll('[data-visibility]')) {
    b.classList.toggle('active', b.dataset.visibility === newVisibility);
  }
  els.visibilityHint.textContent =
    newVisibility === 'public'
      ? 'Anyone can find it in the room list and join.'
      : 'Only people in your Discord call see it. Others join with its code.';

  // The room list: your call's rooms first, then public rooms from anywhere
  const others = roomList.filter((r) => r.id !== state?.roomId);
  els.roomsCount.textContent = `${others.length} open`;
  els.roomList.innerHTML = '';
  if (!others.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = state ? 'No other rooms right now.' : 'No rooms right now. Create one and invite people!';
    els.roomList.appendChild(li);
  }
  for (const r of others) {
    const li = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'room-text';
    const name = document.createElement('b');
    name.textContent = `${r.visibility === 'private' ? '🔒' : '🌐'} ${r.name}`;
    const sub = document.createElement('span');
    const status = r.phase === 'lobby' ? (r.players < r.seats ? 'Waiting for players' : 'Full') : r.phase === 'playing' ? 'Playing' : 'Game over';
    sub.textContent = `${r.label} · ${r.players}/${r.seats} seats · ${status}${r.sameCall ? ' · In your call' : ''}`;
    info.append(name, sub);
    const canSit = r.phase === 'lobby' && r.players < r.seats;
    const join = button(canSit ? 'Join' : 'Watch', () => sendLobby('join', { id: r.id }));
    if (canSit) join.classList.add('primary');
    li.append(info, join);
    els.roomList.appendChild(li);
  }
}

// The card for the room you're in, at the top of the menu.
function renderMyRoom() {
  const board = boardFor(state.mode);
  els.gameTitle.textContent = state.roomName;
  els.gameMode.textContent = MODES[state.mode].label;
  els.myRoomInfo.textContent = roomInfoText();

  // Everyone who has joined, with their colour
  els.gamePlayers.innerHTML = '';
  const joined = state.seatsAllowed.filter((i) => state.seats[i]);
  for (const i of joined) {
    const s = state.seats[i];
    const tag = s.userId === state.hostId ? 'Host' : s.bot ? 'Bot' : s.surrendered ? 'Out' : me && s.userId === me.id ? 'You' : '';
    els.gamePlayers.appendChild(listItem(playerColor(myTheme(), board.colors[i]), sym(board.colors[i]) + s.name, tag));
  }
  const open = state.seatsAllowed.length - joined.length;
  if (state.phase === 'lobby' && open > 0) {
    els.gamePlayers.appendChild(listItem(null, `${open} open seat${open === 1 ? '' : 's'}`, '', true));
  }

  els.playBtn.textContent = state.phase === 'playing' ? (mySeat() >= 0 ? 'Back to game' : 'Watch game') : 'Back to room';
  // A finished game can be reset by anyone; a running one only by the host.
  els.newGameBtn.classList.toggle('hidden', !(state.phase === 'finished' || (state.phase === 'playing' && isHost())));
}

// "🔒 Private · code K7QX" — the code is what friends type to join.
function roomInfoText() {
  const kind = state.visibility === 'private' ? '🔒 Private' : '🌐 Public';
  return `${kind} · code ${state.code}${state.chatOn ? '' : ' · chat off'}`;
}

// ☰ → room settings: only the host can change them.
function renderRoomSettings() {
  els.roomSettings.classList.toggle('hidden', !isHost());
  const pub = state.visibility === 'public';
  els.visibilityBtn.textContent = pub ? '🌐 Public' : '🔒 Private';
  els.visibilityNote.textContent = pub ? '(listed for everyone)' : '(your call or the code)';
  els.chatToggle.textContent = state.chatOn ? 'On' : 'Off';
  els.chatToggle.classList.toggle('off', !state.chatOn);
}

// ☰ → everyone in the room. Mute is just for you; Kick (host only) removes them for good.
let kickArmed = null; // a Kick needs a second tap within 3 s
let kickTimer = null;
function renderPeople() {
  els.peopleList.innerHTML = '';
  const seated = new Map(state.seats.filter((s) => s && !s.bot).map((s) => [s.userId, s]));
  for (const p of state.people) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'name';
    const roles = [p.id === state.hostId && 'host', p.id === me?.id && 'you', !seated.has(p.id) && 'watching'].filter(Boolean);
    name.textContent = p.name + (roles.length ? ` (${roles.join(', ')})` : '');
    if (muted.has(p.id)) name.classList.add('is-muted');
    li.appendChild(name);
    if (p.id !== me?.id) {
      li.appendChild(button(muted.has(p.id) ? 'Unmute' : 'Mute', () => toggleMute(p.id)));
      if (isHost()) {
        const armed = kickArmed === p.id;
        const kick = button(armed ? 'Sure?' : 'Kick', () => {
          if (kickArmed === p.id) {
            kickArmed = null;
            send('kick', { userId: p.id });
          } else {
            kickArmed = p.id;
            clearTimeout(kickTimer);
            kickTimer = setTimeout(() => {
              kickArmed = null;
              renderPeople();
            }, 3000);
          }
          renderPeople();
        });
        kick.classList.add(armed ? 'danger' : 'kick');
        li.appendChild(kick);
      }
    }
    els.peopleList.appendChild(li);
  }
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
  els.roomInfo.textContent = roomInfoText();
  renderRoomSettings();
  renderPeople();

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
  for (const i of seatOrder(board, state.seatsAllowed)) {
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
    if (isColorBlind()) {
      // The seat's shape in place of the plain dot
      const dot = top.querySelector('.seat-dot');
      dot.classList.add('sym');
      dot.textContent = SYMBOLS[colorName];
    }
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
    const rolls = state.rolls || [];
    const sixes = !state.rolled && rolls.length; // 6s kept, waiting for the next roll
    const extra = state.extraTurns ? ` (+${state.extraTurns} extra turn${state.extraTurns > 1 ? 's' : ''})` : '';
    const choices = new Set();
    (state.options || []).forEach((o, i) => o.forEach((t) => choices.add(`${rolls[i]}:${state.tokens[seat]?.[t]}`)));
    let text;
    if (state.skipped) text = myTurn ? 'Three 6s — your turn is skipped!' : `${cur.name} rolled three 6s — turn skipped`;
    else if (myTurn && sixes) text = `You rolled ${rolls.length > 1 ? `${rolls.length} sixes` : 'a 6'} — roll again!`;
    else if (myTurn && !state.rolled) text = 'Your turn — tap the dice!';
    else if (myTurn && choices.size === 1) text = `You rolled ${rolls.join(' + ')} — moving your token…`; // the server moves it
    else if (myTurn && state.movable.length && rolls.length > 1)
      text = `You have ${rolls.join(' + ')} — tap a glowing token, then pick a dice`;
    else if (myTurn && state.movable.length) text = `You rolled a ${rolls[0]} — tap a glowing token`;
    else if (myTurn) text = `You rolled a ${state.dice} — no moves this time`;
    else if (sixes) text = `${cur.name} rolled a 6 — rolling again`;
    else if (state.rolled) text = `${cur.name} rolled ${rolls.length ? rolls.join(' + ') : `a ${state.dice}`}`;
    else text = `${cur.name}'s turn`;
    els.turnText.textContent = sym(board.colors[state.turn]) + text + extra;
    els.turnText.style.color = col(board.colors[state.turn]);
  }
  const racing = phase === 'playing' && seat >= 0 && !state.seats[seat].surrendered && !state.winners.includes(seat);
  els.surrenderBtn.classList.toggle('hidden', !racing);
  els.screens.game.dataset.phase = phase; // the phone layout hides the seat cards while playing

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
    sfx('win');
  }
}

function startEvent(ev, now) {
  current = ev;
  ev.elapsed = 0;
  if (ev.type === 'roll') {
    ev.duration = SPIN_MS;
    // A different tumble each roll: 2–3 turns one way, 1–2 the other.
    const axes = [(2 + Math.random()) * (Math.random() < 0.5 ? -1 : 1), 1 + Math.random()];
    dice = { mode: 'spin', seat: ev.seat, value: ev.value, t0: now, axes, bank: ev.bank };
    sfx('roll');
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
    sfx('land');
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
      sfx('step');
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
    sfx('step');
    if (captured.length) {
      renderer.burst(end.x, end.y, [color, '#ffffff', '#ffd23f'], { count: 22, speed: 5 });
      sfx('capture');
    }
    if (ev.move.finishedToken) {
      renderer.burst(end.x, end.y, [color, '#f6cf57', '#ffffff'], { count: 30, speed: 4, life: 900 });
      sfx('home');
    }
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
    // Back after a move with rolls still to play, or joined mid-turn: show the roll to use
    if (dice.mode === 'hidden' || dice.mode === 'ready') dice = { mode: 'shown', seat: state.turn, value: state.dice, t0: now };
    return;
  }
  // A 6 that was kept stays readable for a moment before the dice comes back for the next roll
  if (dice.mode === 'shown' && state.rolls?.length && now - dice.t0 < SIX_HOLD_MS) return;
  if (dice.mode === 'shown' || (dice.mode === 'ready' && dice.seat !== state.turn)) leave();
  else if (dice.mode === 'hidden') {
    dice = { mode: 'ready', seat: state.turn, t0: now };
    if (state.turn === mySeat() && !state.rolls?.length) showTurnPop(); // not again after each 6
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

// ---------------- choosing a roll ----------------

// You tapped a pin: with one usable roll it just moves; with several, a small
// chooser pops up above the pin showing the dice you can use on it.
function tapToken(token, layoutItem) {
  const rolls = state.rolls;
  const usable = [];
  state.options.forEach((tokens, i) => {
    if (tokens.includes(token) && !usable.some((j) => rolls[j] === rolls[i])) usable.push(i);
  });
  if (usable.length === 0) return;
  if (usable.length === 1) return send('move', { token, roll: usable[0] });

  const box = els.rollChooser;
  box.innerHTML = '<span class="label">Use</span>';
  const board = boardFor(state.mode);
  for (const i of usable) {
    const b = document.createElement('button');
    b.title = `Move ${rolls[i]}`;
    const c = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    c.width = c.height = 40 * dpr;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    drawDice(ctx, 20, 19, 34, rolls[i], state.seats[state.turn]?.skins.dice, { color: col(board.colors[state.turn]) });
    b.appendChild(c);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      closeChooser();
      send('move', { token, roll: i });
    });
    box.appendChild(b);
  }
  const p = renderer.tokenPoint(layoutItem);
  const wrap = els.canvas.parentElement.getBoundingClientRect();
  const half = 30 + usable.length * 23; // keep it inside the board
  box.style.left = `${Math.min(wrap.width - half, Math.max(half, p.x - wrap.left))}px`;
  box.style.top = `${p.y - wrap.top}px`;
  box.classList.toggle('below', p.y - wrap.top < 80); // no room above a pin at the top edge
  box.classList.remove('hidden');
  sfx('step');
}

function closeChooser() {
  els.rollChooser?.classList.add('hidden');
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
  renderer.setBoard(board, myTheme());
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
  const rolls = state.rolls || [];
  let value = dice.value;
  let bank = dice.mode === 'spin' || dice.mode === 'shown' ? dice.bank || [] : [];
  if (dice.mode === 'ready' && !state.rolled) bank = rolls; // the 6s kept so far
  if (dice.mode === 'shown' && state.rolled && idle() && rolls.length) {
    // The rolls still to play: the latest is the big dice, the rest wait above it
    value = rolls.at(-1);
    bank = rolls.slice(0, -1);
  }
  return {
    mode: dice.mode,
    t: now - dice.t0,
    value,
    bank,
    axes: dice.axes,
    style: state.seats[dice.seat]?.skins.dice,
    color: col(board.colors[dice.seat]),
    mine: dice.seat === mySeat(),
  };
}

// ---------------- input ----------------

for (const b of document.querySelectorAll('[data-go]')) b.addEventListener('click', () => showScreen(b.dataset.go));
els.playBtn.addEventListener('click', () => showScreen('game'));

// Rooms: create one, join with a code, leave
for (const b of els.visibilityPicker.querySelectorAll('[data-visibility]')) {
  b.addEventListener('click', () => {
    newVisibility = b.dataset.visibility;
    renderMenu();
  });
}
els.createBtn.addEventListener('click', () => sendLobby('create', { visibility: newVisibility }));
els.codeInput.addEventListener('input', () => {
  els.codeInput.value = els.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});
els.codeForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const code = els.codeInput.value.trim();
  if (code.length !== 4) return toast('Room codes are 4 letters or numbers');
  sendLobby('join', { code });
  els.codeInput.value = '';
});
els.leaveBtn.addEventListener('click', () => sendLobby('leave'));
els.leaveRoomBtn.addEventListener('click', () => {
  setDrawer(false);
  sendLobby('leave');
});
els.visibilityBtn.addEventListener('click', () =>
  send('setVisibility', { visibility: state.visibility === 'public' ? 'private' : 'public' }),
);
els.chatToggle.addEventListener('click', () => send('setChat', { on: !state.chatOn }));
els.startBtn.addEventListener('click', () => send('start'));
els.fillBtn.addEventListener('click', () => send('fillBots'));
els.againBtn.addEventListener('click', () => send('newGame'));
confirmTap(els.surrenderBtn, 'Tap again to surrender', () => {
  send('surrender');
  setDrawer(false);
});

// ☰ opens and closes the drawer with the menu button, surrender and sound settings
const drawer = $('drawer');
const drawerBtn = $('drawer-btn');
function setDrawer(open) {
  drawer.classList.toggle('hidden', !open);
  drawerBtn.setAttribute('aria-expanded', String(open));
}
drawerBtn.addEventListener('click', () => setDrawer(drawer.classList.contains('hidden')));
for (const b of drawer.querySelectorAll('[data-go]')) b.addEventListener('click', () => setDrawer(false));

// Phones show the chat or the log, not both
const panel = drawer.closest('.panel');
function setFeed(feed) {
  panel.dataset.feed = feed;
  for (const b of document.querySelectorAll('[data-feed]')) b.classList.toggle('active', b.dataset.feed === feed);
}
for (const b of document.querySelectorAll('[data-feed]')) b.addEventListener('click', () => setFeed(b.dataset.feed));
setFeed('chat');
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
  closeChooser(); // tapping anywhere else on the board cancels it
  if (!canMove()) return;
  const token = renderer.hitToken(e.clientX, e.clientY, mySeat(), state.movable);
  if (token === null) return;
  const item = renderer.lastLayout.find((it) => it.seat === mySeat() && it.token === token);
  tapToken(token, item);
});

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return; // typing in the chat
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
  sfx('turn');
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

// Seat cards laid out like the seats on the board, two to a row. Four seats: top row first,
// left to right. Six seats: clockwise from the top left, the left side down the left column
// (0, 5, 4) and the right side down the right column (1, 2, 3).
function seatOrder(board, seats) {
  if (board.arms === 6) return [0, 1, 5, 2, 4, 3].filter((s) => seats.includes(s));
  return [...seats].sort((a, b) => {
    const A = board.bases[a];
    const B = board.bases[b];
    return Math.sign(A.y) - Math.sign(B.y) || A.x - B.x;
  });
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
