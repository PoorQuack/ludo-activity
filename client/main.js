import { DiscordSDK } from '@discord/embedded-app-sdk';
import { MODES, boardFor } from '../shared/board.js';
import { SHOP_ITEMS, ownsItem, EMOTE_SLUGS, STICKER_SOUNDS } from '../shared/shop.js';
import { BoardRenderer, SPIN_MS, LEAVE_MS, EMOTE_MS, drawDice } from './renderer.js';
import { renderShop } from './shop-ui.js';
import { playerColor, SYMBOLS, isColorBlind, setColorBlind } from './skins.js';
import { unlockAudio, sfx, setMusic, setSound, setEmoteSounds, stickerSound, setVolume, nextTrack, prevTrack, playTrack, audioSettings } from './audio.js';

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
  screens: { menu: $('menu'), shop: $('shop'), howto: $('howto'), leaderboard: $('leaderboard'), game: $('game') },
  lbBody: $('lb-body'),
  lbTabs: [...document.querySelectorAll('[data-lb]')],
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
  onlineStrip: $('online-strip'),
  onlineText: $('online-text'),
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
  emoteBar: $('emote-bar'), // removed from the layout — emotes live in chat now
  chats: [...document.querySelectorAll('[data-chat]')],
  audioToggles: [...document.querySelectorAll('[data-toggle]')],
  volumes: [...document.querySelectorAll('[data-volume]')],
  volumeValues: [...document.querySelectorAll('[data-volume-value]')],
  playerBtns: [...document.querySelectorAll('[data-player-btn]')],
  playerPop: $('player-pop'),
  playerLabel: $('player-label'),
  playerTitle: $('player-title'),
  playerPlay: $('player-play'),
  playerList: $('player-list'),
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
      renderOnline(msg);
      renderUI();
    } else if (msg.type === 'leaderboard') {
      lbData = msg.boards;
      renderLeaderboard();
    } else if (msg.type === 'awards') showAwards(msg.awards);
    else if (msg.type === 'state') onState(msg.state);
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
    for (const el of els.canvas.parentElement.querySelectorAll('.board-sticker')) el.remove();
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
    // Stickers float as real <img>s so animated ones play; canvas can't animate GIFs.
    if (e.img) {
      spawnBoardSticker(e);
      // Laugh-pack stickers make their noise too (each sender at most every few seconds)
      if (STICKER_SOUNDS[e.img]) stickerSound(STICKER_SOUNDS[e.img], next.seats[e.seat]?.userId ?? e.seat);
    } else floaters.push({ seat: e.seat, emoji: e.emoji, start: performance.now() });
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

const STICKER_MS = 2800;

// A sticker floats up from the sender's base as a DOM image — big and fully animated.
function spawnBoardSticker(e) {
  const wrap = els.canvas.parentElement;
  const b = boardFor(state.mode).bases[e.seat];
  if (!b) return;
  const pt = renderer.toClient(b.x, b.y);
  const wr = wrap.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'board-sticker';
  el.style.left = `${pt.x - wr.left}px`;
  el.style.top = `${pt.y - wr.top}px`;
  const img = document.createElement('img');
  img.src = e.img;
  img.alt = '';
  img.style.width = `${Math.round(renderer.cell * 2.6)}px`;
  el.appendChild(img);
  wrap.appendChild(el);
  setTimeout(() => el.remove(), STICKER_MS);
}

function renderChat() {
  if (!state) return;
  // Typed chat can be turned off by the host; emotes still work
  for (const box of els.chats) {
    const input = box.querySelector('input');
    input.disabled = !state.chatOn;
    box.querySelector('[data-emoji-btn]').disabled = !state.chatOn;
    input.placeholder = state.chatOn ? 'Say something…' : 'The host turned chat off';
    const typists = (state.typing || []).filter((t) => t.id !== me?.id && !muted.has(t.id)).map((t) => t.name);
    const line = box.querySelector('.typing-line');
    const text = typists.length > 1 ? `${typists.join(' & ')} are typing…` : typists.length ? `${typists[0]} is typing…` : '';
    if (line.textContent !== text) line.textContent = text;
    // Typing state expires server-side after ~3.5s; if nothing else updates, clear it ourselves.
    clearTimeout(line._t);
    if (text) line._t = setTimeout(() => { line.textContent = ''; }, 4000);
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
      // :slug: codes come back as stickers (the server already checked ownership).
      // A message of nothing but codes shows them sticker-big; inside text they're small.
      const stickerOnly = m.text.trim().split(/\s+/).every((t) => EMOTE_SLUGS[/^:([a-z0-9-]+):$/.exec(t)?.[1]]);
      for (const part of m.text.split(/(:[a-z0-9-]+:)/g)) {
        const slug = /^:([a-z0-9-]+):$/.exec(part)?.[1];
        const hit = slug && EMOTE_SLUGS[slug];
        if (hit) {
          const img = document.createElement('img');
          img.className = stickerOnly ? 'chat-sticker' : 'chat-emote';
          img.src = hit.img;
          img.alt = `:${slug}:`;
          img.title = hit.name;
          li.appendChild(img);
        } else if (part) li.appendChild(document.createTextNode(part));
      }
      list.appendChild(li);
    }
    if (atBottom || !list.dataset.seen) list.scrollTop = list.scrollHeight;
    list.dataset.seen = '1';
  }
}

// Emotes the current player can pick from: unicode emotes insert the character,
// pack emotes insert a :slug: code that the server verifies on send.
function emoteEntries() {
  const entries = [];
  for (const i of SHOP_ITEMS) {
    if (!ownsItem(profile, i.id)) continue;
    if (i.type === 'emote' && i.img) entries.push({ img: i.img, name: i.name, insert: `:${i.slug}:` });
    else if (i.type === 'emote-pack') i.emotes.forEach((e) => entries.push({ img: e.img, name: e.name, insert: `:${e.slug}:` }));
  }
  return entries;
}

function renderEmojiPops() {
  for (const box of els.chats) {
    const pop = box.querySelector('.emoji-pop');
    const input = box.querySelector('input');
    pop.innerHTML = '';
    const entries = emoteEntries();
    if (!entries.length) {
      const hint = document.createElement('p');
      hint.className = 'emoji-empty';
      hint.textContent = 'No stickers yet — find packs in the Shop';
      pop.appendChild(hint);
    }
    for (const e of entries) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'emote';
      b.title = e.name;
      if (e.img) {
        const img = document.createElement('img');
        img.src = e.img;
        img.alt = e.name;
        b.appendChild(img);
      } else b.textContent = e.emoji;
      b.addEventListener('click', () => {
        const pos = input.selectionStart ?? input.value.length;
        input.setRangeText(e.insert, pos, input.selectionEnd ?? pos, 'end');
        input.dispatchEvent(new Event('input'));
        input.focus();
        pop.classList.add('hidden');
      });
      pop.appendChild(b);
    }
  }
}

let lastTypingSent = 0;

for (const box of els.chats) {
  const form = box.querySelector('form');
  const input = box.querySelector('input');
  const pop = box.querySelector('.emoji-pop');
  const emojiBtn = box.querySelector('[data-emoji-btn]');
  emojiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    pop.classList.toggle('hidden');
  });
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
  input.addEventListener('input', () => {
    updateCount();
    const now = performance.now();
    if (now - lastTypingSent > 1500) {
      lastTypingSent = now;
      send('typing');
    }
  });
  updateCount();
  // On phones, tapping Send must not take focus from the box: that would close the keyboard
  // after every message.
  const sendBtn = form.querySelector('button[type="submit"]');
  for (const ev of ['pointerdown', 'mousedown']) sendBtn.addEventListener(ev, (e) => e.preventDefault());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    send('chat', { text });
    input.value = '';
    updateCount();
    if (document.documentElement.classList.contains('kb-open')) input.focus({ preventScroll: true });
  });
}

// ---------------- phones: the on-screen keyboard ----------------
// While someone types on a phone, the game is pinned to the part of the screen above the
// keyboard (the visual viewport): the board shrinks and the chat box sits right on top of the
// keyboard. Without this the browser scrolls the page to keep the box in view while the layout
// resizes under it, and everything jumps about.
if (matchMedia('(hover: none) and (pointer: coarse)').matches) {
  const root = document.documentElement;
  const vv = window.visualViewport;
  const isChat = (el) => !!el?.matches?.('.chat-form input');
  const fit = () => {
    if (!root.classList.contains('kb-open')) return;
    root.style.setProperty('--kb-h', `${Math.round(vv ? vv.height : window.innerHeight)}px`);
    root.style.setProperty('--kb-top', `${Math.round(vv ? vv.offsetTop : 0)}px`);
  };
  document.addEventListener('focusin', (e) => {
    if (!isChat(e.target) || screen !== 'game') return;
    root.classList.add('kb-open');
    fit();
  });
  document.addEventListener('focusout', (e) => {
    if (!isChat(e.target)) return;
    // Focus moves for a moment when an emoji is picked: only close if it really left the chat
    setTimeout(() => {
      if (isChat(document.activeElement)) return;
      root.classList.remove('kb-open');
      window.scrollTo(0, 0); // iPhones leave the page scrolled after the keyboard goes
    }, 150);
  });
  vv?.addEventListener('resize', fit);
  vv?.addEventListener('scroll', fit);
}

// "● 12 players online · 3 games in progress" at the top of the menu
function renderOnline({ online, games }) {
  if (!Number.isFinite(online)) return;
  const people = `${online} player${online === 1 ? '' : 's'} online`;
  const playing = games ? ` · ${games} game${games === 1 ? '' : 's'} in progress` : '';
  els.onlineText.innerHTML = `<span class="online-dot"></span><b>${people}</b>${playing}`;
  els.onlineStrip.classList.remove('hidden');
}

// ---------------- leaderboards ----------------

let lbData = null; // { week, month } from the server, fetched each time the screen opens
let lbTab = 'week';

for (const b of els.lbTabs) {
  b.addEventListener('click', () => {
    lbTab = b.dataset.lb;
    renderLeaderboard();
  });
}

// "3d 14h" / "5h 20m" / "12m"
function timeLeft(ms) {
  const m = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m % 60}m`;
  return `${m % 60}m`;
}

function renderLeaderboard() {
  for (const b of els.lbTabs) b.classList.toggle('active', b.dataset.lb === lbTab);
  const body = els.lbBody;
  if (!lbData) {
    body.innerHTML = '<p class="lb-note">Loading…</p>';
    return;
  }
  const b = lbData[lbTab];
  const word = lbTab === 'week' ? 'week' : 'month';
  const coin = '<span class="coin"></span>';
  const row = (e, mine) => `<li class="lb-row${e.rank <= 3 ? ` top${e.rank}` : ''}${mine ? ' you' : ''}">
      <span class="lb-rank">${MEDALS[e.rank - 1] || e.rank}</span>
      <span class="lb-name">${escapeHtml(e.name)}${mine ? ' <small>(you)</small>' : ''}</span>
      <span class="lb-wins">${e.wins} win${e.wins === 1 ? '' : 's'}</span>
      <b class="lb-pts">${e.points}</b>
    </li>`;
  let rows = b.top.map((e) => row(e, e.you)).join('');
  if (b.me && b.me.rank > b.top.length) rows += `<li class="lb-gap">⋯</li>${row({ ...b.me, name: me?.name || 'You' }, true)}`;
  const list = b.top.length
    ? `<ol class="lb-list">${rows}</ol>`
    : `<p class="lb-note">No scores yet this ${word}. Finish games against other people to get on the board!</p>`;
  const yours = b.me
    ? `You're <b>${ordinal(b.me.rank)}</b> of ${b.players} with <b>${b.me.points}</b> points.`
    : `You're not on the board yet this ${word}.`;
  const last = b.last?.podium?.length
    ? `<section class="lb-last"><h3>Last ${word}'s winners</h3><ol>${b.last.podium
        .map((p) => `<li>${MEDALS[p.place - 1]} ${escapeHtml(p.name)} <span>${p.points} pts · +${p.coins} ${coin}</span></li>`)
        .join('')}</ol></section>`
    : '';
  body.innerHTML = `
    <section class="lb-prizes">
      <div class="lb-prize-row">${b.prizes.map((c, i) => `<span class="lb-prize">${MEDALS[i]} ${coin}<b>${c}</b></span>`).join('')}</div>
      <p class="lb-note">Top 3 win coins when the ${word} ends · resets in <b>${timeLeft(b.endsAt - (Date.now() + clockOffset))}</b></p>
    </section>
    ${list}
    <p class="lb-you">${yours}</p>
    ${last}
    <p class="lb-note">Points = the coins a game pays you before the daily limit, in games against other people. Ties go to more wins.</p>`;
}

// Prizes won (told once, when you next connect)
function showAwards(awards) {
  const text = awards
    .map((a) => `🏆 You came ${ordinal(a.place)} in last ${a.kind === 'week' ? "week's" : "month's"} leaderboard: +${a.coins} coins!`)
    .join('  ');
  toast(text, 'win', 9000);
  sfx('win');
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
    else if (b.dataset.toggle === 'emoteSounds') setEmoteSounds(!s.emoteSounds);
    else setSound(!s.sound);
    renderAudioToggles();
  });
}

// ---------------- music player ----------------

const popOpenFor = { btn: null };

function renderPlayer() {
  const s = audioSettings();
  const list = s.tracks || [];
  // The track section only exists once sounds.json has loaded a playlist; the volumes always show.
  for (const el of [$('player-now'), $('player-controls'), els.playerList]) el.classList.toggle('hidden', list.length === 0);
  const cur = list.find((t) => t.id === s.musicTrack) || list[0];
  els.playerLabel.textContent = cur ? cur.label : '';
  els.playerTitle.textContent = cur ? [cur.title, cur.artist].filter(Boolean).join(' — ') : '';
  els.playerPlay.textContent = s.music ? '⏸' : '▶';
  els.playerList.innerHTML = '';
  for (const t of list) {
    const b = document.createElement('button');
    b.className = t === cur ? 'active' : '';
    b.innerHTML = `${escapeHtml(t.label)}<small>${escapeHtml([t.title, t.artist].filter(Boolean).join(' — '))}</small>`;
    b.addEventListener('click', () => playTrack(t.id));
    els.playerList.appendChild(b);
  }
}

function closePlayer() {
  els.playerPop.classList.add('hidden');
  popOpenFor.btn?.setAttribute('aria-expanded', 'false');
  popOpenFor.btn = null;
}

function openPlayer(btn) {
  const r = btn.getBoundingClientRect();
  els.playerPop.style.top = `${r.bottom + 6}px`;
  els.playerPop.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  els.playerPop.style.maxHeight = `${window.innerHeight - r.bottom - 14}px`; // scrolls rather than running off-screen
  els.playerPop.classList.remove('hidden');
  btn.setAttribute('aria-expanded', 'true');
  popOpenFor.btn = btn;
}

for (const b of els.playerBtns) {
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (els.playerPop.classList.contains('hidden')) openPlayer(b);
    else if (popOpenFor.btn === b) closePlayer();
    else {
      popOpenFor.btn?.setAttribute('aria-expanded', 'false');
      openPlayer(b);
    }
  });
}
document.addEventListener('pointerdown', (e) => {
  if (!els.playerPop.classList.contains('hidden') && !els.playerPop.contains(e.target) && !e.target.closest('[data-player-btn]')) {
    closePlayer();
  }
  if (!e.target.closest('.emoji-pop') && !e.target.closest('[data-emoji-btn]')) {
    for (const p of document.querySelectorAll('.emoji-pop:not(.hidden)')) p.classList.add('hidden');
  }
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closePlayer();
    for (const p of document.querySelectorAll('.emoji-pop:not(.hidden)')) p.classList.add('hidden');
  }
});
$('player-prev').addEventListener('click', prevTrack);
$('player-next').addEventListener('click', nextTrack);
els.playerPlay.addEventListener('click', () => setMusic(!audioSettings().music));

window.addEventListener('ludo-audio-change', renderPlayer);
window.addEventListener('ludo-audio-ready', () => {
  renderAudioToggles();
  renderPlayer(); // the 🎵 buttons appear once the playlist is known
});
renderAudioToggles();
renderPlayer();

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
    drawMenuBoard();
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
  if (name === 'leaderboard') {
    renderLeaderboard();
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'leaderboard' }));
  }
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
  els.menuName.textContent = me ? me.name : '';
  els.menuName.title = me ? `Signed in as ${me.name}` : '';
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
    li.textContent = state ? 'No other rooms right now.' : 'No open rooms right now.';
    els.roomList.appendChild(li);
  }
  // Each row: name (with a lock if private), mode + status, one dot per seat, Join or Watch
  for (const r of others) {
    const li = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'room-text';
    const name = document.createElement('div');
    name.className = 'room-name';
    if (r.visibility === 'private') name.innerHTML = LOCK_ICON;
    const nameText = document.createElement('span');
    nameText.textContent = r.name;
    name.appendChild(nameText);
    const meta = document.createElement('div');
    meta.className = 'room-meta';
    const status = r.phase === 'lobby' ? (r.players < r.seats ? 'Waiting' : 'Full') : r.phase === 'playing' ? 'Playing' : 'Game over';
    meta.textContent = `${r.label} · ${status}`;
    if (r.sameCall) {
      const call = document.createElement('span');
      call.className = 'room-call';
      call.textContent = ' · in your call';
      meta.appendChild(call);
    }
    info.append(name, meta);

    const seats = document.createElement('span');
    seats.className = 'room-seats';
    seats.title = `${r.players} of ${r.seats} seats taken`;
    seats.setAttribute('aria-label', seats.title);
    for (let i = 0; i < r.seats; i++) {
      const dot = document.createElement('i');
      if (i < r.players) dot.className = 'on';
      seats.appendChild(dot);
    }

    const canSit = r.phase === 'lobby' && r.players < r.seats;
    const join = button(canSit ? 'Join' : 'Watch', () => sendLobby('join', { id: r.id }));
    join.classList.add(canSit ? 'join' : 'watch');
    li.append(info, seats, join);
    els.roomList.appendChild(li);
  }
  drawMenuBoard();
}

const LOCK_ICON =
  '<svg class="ico" viewBox="0 0 16 16" aria-label="Private"><rect x="3.25" y="7" width="9.5" height="7" rx="1.5" /><path d="M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7" /></svg>';

// ---------------- menu: the board beside the actions (wide screens) ----------------
// A still picture of the player's own board: drawn when the menu shows, and again only when
// its size, the board theme, the token skin or colour-blind mode changes. No frame loop.
const menuBoard = new BoardRenderer($('menu-board'));
const menuBoardCaption = $('menu-board-caption');
const MENU_BOARD = boardFor('4p');
const MENU_BOARD_MAX = 420;
let menuBoardKey = '';

function drawMenuBoard() {
  if (screen !== 'menu') return;
  const hero = menuBoard.canvas.parentElement;
  const width = hero.clientWidth; // 0 when the hero is hidden (narrow screens)
  if (!width) return;
  const size = Math.min(MENU_BOARD_MAX, width);
  const theme = myTheme() || 'board-classic';
  const skin = profile?.equipped?.token || null;
  const key = [size, window.devicePixelRatio || 1, theme, skin, isColorBlind()].join('|');
  if (key === menuBoardKey) return;
  menuBoardKey = key;
  menuBoard.setBoard(MENU_BOARD, theme);
  menuBoard.resize(size);
  const seats = MENU_BOARD.colors.map((_, i) => i);
  menuBoard.draw(
    {
      tokens: seats.map(() => [-1, -1, -1, -1]),
      active: seats,
      skins: seats.map(() => skin),
      overrides: null,
      highlight: null,
      turn: null,
      dice: null,
      emotes: [],
    },
    performance.now(),
  );
  const themeName = SHOP_ITEMS.find((i) => i.id === theme)?.name;
  menuBoardCaption.innerHTML = '';
  if (themeName) {
    const b = document.createElement('b');
    b.textContent = themeName;
    menuBoardCaption.append('Your board: ', b, ' · change it in the Shop');
  }
}

let menuResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(menuResizeTimer);
  menuResizeTimer = setTimeout(drawMenuBoard, 120);
});

// The card for the room you're in, at the top of the menu.
function renderMyRoom() {
  const board = boardFor(state.mode);
  els.gameTitle.textContent = state.roomName;
  els.gameMode.textContent = MODES[state.mode].label;
  // Menu version of the room info: the lock icon instead of emoji, to match the room list
  const kind = state.visibility === 'private' ? `${LOCK_ICON} Private` : 'Public';
  els.myRoomInfo.innerHTML = `${kind} · code ${escapeHtml(state.code)}${state.chatOn ? '' : ' · chat off'}`;

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
      // Just dropped out: the server waits a few seconds for them before playing for them
      const away = s.disconnectedAt && state.serverNow - s.disconnectedAt < state.disconnectGrace ? ' · reconnecting…' : ' · offline (auto)';
      sub.textContent =
        place >= 0
          ? `🏆 ${ordinal(place + 1)} place`
          : `${home}/4 home${s.connected ? '' : away}${missed ? ` · ⏰ ${missed}/${state.maxTimeouts}` : ''}`;
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
    if (state.paused) {
      text = `Paused — every player left. The game ends in ${Math.round(state.pauseMs / 1000)}s if nobody comes back`;
      els.turnText.textContent = `⏸️ ${text}`;
    } else els.turnText.textContent = sym(board.colors[state.turn]) + text + extra;
    els.turnText.style.color = col(board.colors[state.turn]);
  }
  const racing = phase === 'playing' && seat >= 0 && !state.seats[seat].surrendered && !state.winners.includes(seat);
  els.surrenderBtn.classList.toggle('hidden', !racing);
  els.screens.game.dataset.phase = phase; // the phone layout hides the seat cards while playing

  if (phase !== 'finished') els.banner.classList.add('hidden');

  // Emotes live in chat now: the emoji button on the chat form opens the picker.
  renderEmojiPops();
}

function showFinish() {
  const lines = state.winners.map((s, i) => {
    const coins = state.rewards?.[s];
    const capped = state.rewardCapped?.includes(s);
    const partial = state.rewardPartial?.includes(s);
    const note = [capped ? 'daily limit reached' : '', partial ? 'ended early' : ''].filter(Boolean).join(', ');
    const reward = coins || capped ? ` <span class="reward">+${coins || 0} 🪙${note ? ` (${note})` : ''}</span>` : '';
    return `${MEDALS[i] || `${i + 1}.`} ${escapeHtml(state.seats[s]?.name)}${reward}`;
  });
  const why = {
    bots: 'No coins for games against bots only — play with friends to earn.',
    abandoned: 'Everyone left and nobody came back, so no coins this time.',
  }[state.noCoins];
  const title = state.noCoins === 'abandoned' ? 'Game ended' : 'Game over!';
  const note = why ? `<div class="banner-note">${why}</div>` : '';
  els.banner.innerHTML = `<div class="banner-title">${title}</div>${lines.join('<br>')}${note}`;
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

// A roll we've sent but the server hasn't answered yet: until the next roll shows up
// (or 2s pass), more taps are ignored, so a double-tap can't roll twice.
let rollPending = null; // { seq, at }

function sendRoll() {
  rollPending = { seq: state.lastRoll?.seq ?? null, at: performance.now() };
  send('roll');
}

function canRoll() {
  const waiting = rollPending && rollPending.seq === (state?.lastRoll?.seq ?? null) && performance.now() - rollPending.at < 2000;
  return state?.phase === 'playing' && mySeat() === state.turn && !state.rolled && dice.mode === 'ready' && idle() && !waiting;
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
  if (canRoll() && renderer.hitDice(e.clientX, e.clientY)) return sendRoll();
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
    sendRoll();
  }
});

// ---------------- helpers ----------------

function setLoading(text) {
  els.loadingText.textContent = text;
}

let toastTimer = null;
function toast(text, kind = 'error', ms = 2500) {
  els.toast.textContent = text;
  els.toast.className = `toast ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), ms);
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

// 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st, 102nd
function ordinal(n) {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return `${n}${teen ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
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
