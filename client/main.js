import { DiscordSDK } from '@discord/embedded-app-sdk';
import { MODES, boardFor } from '../shared/board.js';
import { REWARDS, SHOP_ITEMS, ITEMS, ownsItem, EMOTE_SLUGS, setPrice, priceOf, dailyDeal, rarityOf, DEAL_DISCOUNT, dayKeyOf, currencyOf, STARTER, POT_FEE } from '../shared/shop.js';
import { BoardRenderer, SPIN_MS, LEAVE_MS, EMOTE_MS, drawDice } from './renderer.js';
import { renderShop, itemPreview, commitShopSeen } from './shop-ui.js';
import { TAUNT_FX } from './taunts.js';
import { setSceneLighting, setSceneMode, sceneSwitch } from './scene.js';
import { renderProfile, lookHtml, medalHtml } from './profile.js';
import { playerLevel, BADGES, BADGES_BY_ID, LEVELS, levelFor } from '../shared/badges.js';
import { openItemView, refreshItemView, closeItemView } from './item-view.js';
import { D20 } from './d20.js';
import { openCoinStore, preloadPrices, refreshCoinStore, gemsInMoney, paidPrice } from './coin-store.js';
import { PASS_TIERS, XP_PER_TIER, PASS_XP, passRewards, seasonFor } from '../shared/pass.js';
import { REACTION_EMOJIS } from '../shared/chat.js';
import { PASS_SKU_ID, STAKES } from '../shared/shop.js';
import { setFrame } from './frames.js';
import { signatureHome } from './signatures.js';
import { maybeTour, openTour } from './tour.js';
import { playerColor, SYMBOLS, isColorBlind, colorBlindMode, setColorBlindMode, CB_MODES, BOARD_THEMES, TOKEN_SIGNATURES } from './skins.js';
import { t, translateServer, setLanguage, languagePref, setAutoLocale, LANGUAGES, applyI18n, currentLanguage as currentLang, chatLanguage, chatLanguagePref, setChatLanguage } from './i18n.js';
import { CHAT_LANGUAGES, CHAT_LANG } from '../shared/chatlangs.js';
import { unlockAudio, playedJustNow, sfx, setMusic, setSound, setVolume, nextTrack, prevTrack, playTrack, audioSettings } from './audio.js';

// The menu's chat: which channel is shown, what's in each (see "the menu's chat" below)
const lchat = { open: false, tab: 'global', lang: null, global: [], local: [], unseen: { global: false, lang: false } };

if (typeof window !== 'undefined') window.sfx = sfx;

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
  screens: { menu: $('menu'), shop: $('shop'), howto: $('howto'), game: $('game'), profile: $('profile') },
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
  todayCard: $('today-card'),
  questList: $('quest-list'),
  questsReset: $('quests-reset'),
  questsBonus: $('quests-bonus'),
  codeForm: $('code-form'),
  codeInput: $('code-input'),
  roomList: $('room-list'),
  roomInfo: $('room-info'),
  leaveRoomBtn: $('leave-room-btn'),
  roomSettings: $('room-settings'),
  visibilityNote: $('visibility-note'),
  visibilityBtn: $('visibility-btn'),
  quickBtn: $('quick-btn'),
  peopleList: $('people-list'),
  surrenderBtn: $('surrender-btn'),
  shopTabs: $('shop-tabs'),
  shopGrid: $('shop-grid'),
  coins: [...document.querySelectorAll('.coins')],
  gems: [...document.querySelectorAll('.gems')],
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
renderer.marksFollowTurns = true; // a taunt's mark lasts until the victim's turn
renderer.splitLayers(); // the board, its effect and the pieces are painted separately

let ws = null;
let hello = null;
let discordSdk = null; // set once logged in through Discord
let inviteShown = false;
let quietCoinsUntil = 0; // a quest toast is showing: don't replace it with "+N coins!"
let friendsData = null; // { friends: [...], met: [...] }
let friendsTab = 'friends';
let friendsInRoom = false;
let dailyAnim = null; // the d20 is rolling
let me = null;
let profile = null;
let state = null; // the room you're in (null when you're not in one)
let roomList = []; // rooms you could join, from the server
let newVisibility = 'public'; // the Public/Private choice for "Create room"
let clockOffset = 0;
let reconnectDelay = 500;
let updating = false; // the server said it's restarting for an update: reconnecting is expected
let screen = 'loading';
let shopTab = 'featured'; // the shop opens on its front page
let freeShop = false; // server is in testing mode: everything costs 0
let paidConfig = { skus: [], tipUrl: '' }; // coin packs / coffees on sale through Discord (see coin-store.js)

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
let pendingRoll = null; // { seq, seat, t0, retried } while waiting for a roll response
let wsPingTimer = null;
let wsPongTimer = null;
let celebrated = false;
let finishTimer = null;
let lastFrame = 0;
// The server state the panel shows. It follows the board: each animation carries the state
// that arrived with (or after) it, and the panel moves on to that state when it finishes.
let view = null;

// ---------------- startup ----------------

async function main() {
  await setLanguage(languagePref(), { save: false });
  try {
    const config = await fetch(`${BASE}/api/config`).then((r) => r.json());
    freeShop = !!config.freeShop;
    paidConfig = config.paid || { skus: [], tipUrl: '' };
    if (inDiscord) {
      hello = await discordLogin(config.clientId);
    } else {
      hello = guestLogin();
    }
    connect();
  } catch (err) {
    console.error(err);
    els.loadingText.textContent = t("Couldn't start: {why}", { why: translateServer(err.message) });
  }
}

async function discordLogin(clientId) {
  setLoading(t('Talking to Discord…'));
  const sdk = new DiscordSDK(clientId);
  discordSdk = sdk;
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
  if (!res.ok) throw new Error(t('Login failed'));
  const { access_token } = await res.json();
  await sdk.commands.authenticate({ access_token });
  // Follow Discord's language unless the player picked one (needs no extra permission on most clients)
  sdk.commands
    .userSettingsGetLocale?.()
    .then((r) => r?.locale && setAutoLocale(r.locale))
    .catch(() => {});
  // A purchase finished in Discord (even one the checkout didn't report back): get it paid out
  sdk.subscribe('ENTITLEMENT_CREATE', () => claimPurchases()).catch(() => {});
  // Opened through someone's shared link? Discord says who shared it (for the referral coins).
  return { type: 'hello', accessToken: access_token, instanceId: sdk.instanceId, referrerId: sdk.referrerId || undefined };
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

function clearWsHeartbeat() {
  clearInterval(wsPingTimer);
  clearTimeout(wsPongTimer);
  wsPingTimer = null;
  wsPongTimer = null;
}

function connect() {
  clearWsHeartbeat();
  setLoading(updating ? t('🔧 Updating the game… back in a few seconds') : state ? t('Reconnecting…') : t('Joining game…'));
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}${BASE}/ws`);
  ws = sock;
  sock.onopen = () => {
    if (ws !== sock) return;
    reconnectDelay = 500;
    // After a refresh or a dropped connection, go back to the room we were in
    sock.send(JSON.stringify({ ...hello, rejoin: savedRoom() }));
    wsPingTimer = setInterval(() => {
      if (ws !== sock || sock.readyState !== WebSocket.OPEN) return;
      sock.send(JSON.stringify({ type: 'ping', t: Date.now() }));
      clearTimeout(wsPongTimer);
      wsPongTimer = setTimeout(() => {
        if (ws === sock && sock.readyState === WebSocket.OPEN) sock.close();
      }, 5000);
    }, 12_000);
  };
  sock.onmessage = (e) => {
    if (ws !== sock) return;
    clearTimeout(wsPongTimer);
    wsPongTimer = null;
    const msg = JSON.parse(e.data);
    if (msg.type === 'pong') return;
    if (msg.type === 'welcome') {
      me = msg.you;
      chatLangSent = null; // a new connection: tell this one
      sendChatLang();
      els.loading.classList.add('hidden');
      if (updating) {
        updating = false;
        toast(t("✅ Update done, you're back!"), 'ok', 3500);
      }
      if (screen === 'loading') showScreen('menu');
      lbAsked = 0;
      fetchLeaderboard();
      if (lchat.open) lobbyChatJoin(); // back after a reconnect with the chat open
    } else if (msg.type === 'profile') onProfile(msg.profile);
    else if (msg.type === 'playNew') {
      toast(t('No open games right now, so here is a new one. Add bots or wait for people to join.'), 'ok', 6000);
      loneSince = Date.now();
      setTimeout(renderUI, LONE_MS + 50);
    }
    else if (msg.type === 'badges') {
      gameLog?.badges.push(...msg.reached);
      if (state?.phase === 'finished') setTimeout(refreshFinish, 50); // (after the profile with the new totals)
      // a badge level reached: one toast each (the coins come in the profile update)
      quietCoinsUntil = Date.now() + 1500;
      sfx('home');
      for (const r of msg.reached) {
        const b = BADGES_BY_ID[r.badge];
        if (!b) continue;
        const lv = t(['Bronze', 'Silver', 'Gold'][r.level - 1]);
        toast(`${b.icon} ${t('Badge: {badge} ({level})! +{n} coins', { badge: t(b.name), level: lv, n: r.coins })}${r.level === 3 ? ` · ${t('New title unlocked')}` : ''}`, 'ok', 6000);
      }
    }
    else if (msg.type === 'rooms') {
      roomList = msg.rooms;
      if (!$('stakes-sheet').classList.contains('hidden')) renderStakesSheet();
      renderOnline(msg);
      renderUI();
    } else if (msg.type === 'leaderboard') {
      lbData = msg.boards;
      renderLeaderboard();
    } else if (msg.type === 'passXp') {
      const why = msg.login ? t('Daily login') : t('Quest done');
      toast(msg.tierUp ? t('🎟️ Battle Pass tier {n} reached!', { n: msg.tier }) : t('🎟️ +{xp} Battle Pass XP · {why}', { xp: msg.xp, why }), 'ok', 3500);
    } else if (msg.type === 'passClaimed') {
      sfx('buy');
      const got = msg.given || [];
      const coins = got.reduce((n, g) => n + (g.coins || 0), 0);
      const gems = got.reduce((n, g) => n + (g.gems || 0), 0);
      const items = got.filter((g) => g.item).map((g) => t(ITEMS[g.item]?.name || ''));
      const parts = [coins && `+${coins} ${t('coins')}`, gems && `+${gems} ${t('gems')}`, ...items].filter(Boolean);
      if (parts.length) toast(`🎁 ${parts.join(' · ')}`, 'ok', 4500);
    } else if (msg.type === 'lobbyChat') onLobbyChat(msg);
    else if (msg.type === 'dmSummary' || msg.type === 'dmHistory' || msg.type === 'dmMsg' || msg.type === 'dmReact') onDmMessage(msg);
    else if (msg.type === 'translated') onTranslated(msg);
    else if (msg.type === 'trFeedback') onTrFeedback(msg);
    else if (msg.type === 'awards') showAwards(msg.awards);
    else if (msg.type === 'quests') {
      questData = msg.quests;
      weeklyData = msg.weekly || null;
      renderQuests();
    } else if (msg.type === 'questsDone') {
      showQuestsDone(msg.completed);
      gameLog?.quests.push(...msg.completed);
      if (state?.phase === 'finished') refreshFinish();
    }
    else if (msg.type === 'invite') showInvite(msg.url);
    else if (msg.type === 'daily') onDailyRoll(msg);
    else if (msg.type === 'friends') {
      friendsData = msg;
      renderFriends();
      if (!$('room-friends-modal').classList.contains('hidden')) renderRoomFriends();
      renderPrefs();
      renderLobbyChat();
      refreshInspectedPlayer();
    } else if (msg.type === 'playerProfile') {
      renderPlayerCardModal(msg.user);
    } else if (msg.type === 'inbox') {
      inboxData = msg;
      renderInbox();
    } else if (msg.type === 'friendRequest') {
      sfx('turn');
      toast(t('👋 {name} sent you a friend request', { name: msg.from.name }), 'notice', 4500);
    } else if (msg.type === 'friendResult') {
      const name = friendsData?.met?.find((m) => m.id === msg.id)?.name || friendsData?.friends?.find((f) => f.id === msg.id)?.name || t('them');
      if (msg.result === 'sent') toast(t('Friend request sent to {name}', { name }), 'ok', 3000);
      else if (msg.result === 'accepted') toast(t('🤝 You and {name} are friends now', { name }), 'ok', 3500);
      else if (msg.result === 'pending') toast(t('Already sent: waiting for {name} to answer', { name }), 'notice', 3000);
    } else if (msg.type === 'announcement') {
      sfx('turn');
      toast(t('📣 {title}', { title: msg.item.title }), 'notice', 5000);
    } else if (msg.type === 'purchased') {
      sfx('buy');
      if (msg.kind === 'starter' && msg.coins) toast(t('🎁 Starter Pack unlocked! +{gems} gems & +{coins} coins', { gems: msg.gems, coins: msg.coins }), 'ok', 6000);
      else if (msg.kind === 'gems' || msg.kind === 'starter') toast(t('💎 +{gems} gems! Thank you for your support', { gems: msg.gems }), 'ok', 5000);
      else if (msg.kind === 'pass') toast(t('🎟️ Battle Pass unlocked! Claim your premium rewards.'), 'ok', 6000);
      else toast(t('☕ Thank you so much for the coffee!'), 'ok', 5000);
    } else if (msg.type === 'checkoutUrl') {
      const w = checkoutWaiters.get(msg.reqId);
      if (w) {
        checkoutWaiters.delete(msg.reqId);
        clearTimeout(w.timer);
        if (msg.error || !msg.url) w.reject(new Error(msg.error || 'Checkout unavailable'));
        else w.resolve(msg.url);
      }
    } else if (msg.type === 'referral') {
      sfx('buy');
      toast(t('🎉 {name} played their first game: +{coins} coins for inviting them!', { name: msg.name, coins: msg.coins }), 'ok', 5000);
    } else if (msg.type === 'friendInvited') toast(msg.how === 'dm' ? t("📨 Invite sent to {name}'s Discord DMs", { name: msg.name }) : t('📨 Invite sent to {name}', { name: msg.name }), 'ok', 3500);
    else if (msg.type === 'roomInvite') showRoomInvite(msg);
    else if (msg.type === 'state') onState(msg.state);
    else if (msg.type === 'left') onLeft(msg.message);
    else if (msg.type === 'error') {
      toast(translateServer(msg.message));
      // A roll or move that was already playing out but the server refused: undo it
      if (current?.predicted) {
        current = null;
        shownTokens = latestTokens;
      }
      rollPending = null;
      pendingRoll = null;
      if (dice.mode === 'spin' && dice.waiting) dice = { mode: 'ready', seat: dice.seat, t0: performance.now() };
      if (dailyAnim) {
        dailyAnim = null;
        if (pendingDailyProfile) {
          const p = pendingDailyProfile;
          pendingDailyProfile = null;
          onProfile(p);
        }
        renderDaily();
      }
    }
    else if (msg.type === 'supportSent' || msg.type === 'supportError') onSupportReply(msg);
    else if (msg.type === 'notice') {
      if (msg.kind === 'restart') updating = true;
      toast(msg.text, msg.kind === 'info' ? 'ok' : 'notice', msg.kind === 'soon' ? 9000 : 6000);
    }
  };
  sock.onclose = (e) => {
    if (ws !== sock) return;
    clearWsHeartbeat();
    rollPending = null;
    pendingRoll = null;
    if (dice.mode === 'spin' && dice.waiting) dice = { mode: 'ready', seat: dice.seat, t0: performance.now() };
    if (dailyAnim) {
      dailyAnim = null;
      if (pendingDailyProfile) {
        const p = pendingDailyProfile;
        pendingDailyProfile = null;
        onProfile(p);
      }
    }
    if (e.code === 1012) updating = true; // "service restart": the server is updating
    if (updating) setLoading(t('🔧 Updating the game… back in a few seconds'));
    els.loading.classList.remove('hidden');
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 8000);
  };
}

function send(action, extra = {}) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'action', action, ...extra }));
}

// Creating, joining and leaving rooms.
let afterCreate = null; // 'bots': the room being made is for a game against bots (fill it and start)
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

function sendShop(op, item, to, extra = {}) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'shop', op, item, to, ...extra }));
}

// ---------------- server updates ----------------

let pendingDailyProfile = null;

function onProfile(next) {
  if (dailyAnim) {
    pendingDailyProfile = next;
    return;
  }
  const gained = profile && next.coins > profile.coins ? next.coins - profile.coins : 0;
  profile = next;
  if (gained) {
    if (Date.now() > quietCoinsUntil) toast(t('+{n} coins!', { n: gained }), 'ok');
    bumpCoins();
  }
  if (screen === 'shop') drawShop();
  else refreshItemView(shopContext());
  refreshCoinStore(profile);
  if (screen === 'profile') drawProfile();
  if ($('menu').dataset.panel === 'pass' || wide.matches) renderPass();
  passDot();
  renderEmojiPops();
  renderProfileCard(); // (the title under your name)
  renderNewDots();
  renderUI();
}

// ---------------- "something new" dots ----------------
// On your name: a badge level you haven't looked at yet (opening the profile marks them seen).
const SEEN_KEY = 'ludo-badges-seen';
const store_ = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};
function seenBadges() {
  try {
    return JSON.parse(store_.get(SEEN_KEY) || 'null');
  } catch {
    return null;
  }
}
// badge ids whose level is higher than the last time you opened your profile
function newBadges() {
  const levels = profile?.badges || {};
  let seen = seenBadges();
  if (!seen) {
    // first time on this device: what you already have isn't news
    seen = { ...levels };
    store_.set(SEEN_KEY, JSON.stringify(seen));
  }
  return Object.keys(levels).filter((id) => levels[id] > (seen[id] || 0));
}
function renderNewDots() {
  $('profile-card').classList.toggle('has-new', !!profile && newBadges().length > 0);
}

// ---------------- profile: badges, title, pins ----------------
function drawProfile() {
  const fresh = newBadges();
  if (fresh.length) store_.set(SEEN_KEY, JSON.stringify({ ...(seenBadges() || {}), ...profile.badges }));
  renderProfile($('profile-body'), {
    profile,
    fresh,
    name: me?.name,
    onTitle: (badge) => {
      sfx('equip');
      sendShop('title', null, null, { badge });
    },
    onPins: (pins) => {
      sfx('toggle');
      sendShop('pins', null, null, { pins });
    },
    onPinsFull: () => toast(t('You can pin up to {n} badges', { n: 3 }), 'error'),
  });
}
$('profile-card').addEventListener('click', () => showScreen('profile'));
$('profile-card').addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), showScreen('profile')));

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
  if (message) toast(translateServer(message));
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
    chatPrimed = false;
    chatUnread = 0;
    chatVersion++;
    lastEmoteId = Math.max(0, ...next.emotes.map((e) => e.id));
    floaters = [];
    for (const el of els.canvas.parentElement.querySelectorAll('.board-sticker')) el.remove();
    closeChooser();
    showScreen('game');
    // "Vs. Bots" from the hub: a private room that fills itself with bots and starts
    if (afterCreate === 'bots' && next.phase === 'lobby' && next.hostId === me?.id) {
      send('fillBots');
      send('start');
    }
    afterCreate = null;
  }

  // A game starting: remember your badge stats, to show what it moved on the finish card
  if (next.phase === 'playing' && prev?.phase !== 'playing') gameLog = { stats: { ...(profile?.stats || {}) }, quests: [], badges: [] };

  // A tie on points: tell everyone what happens now
  if (prev && !prev.decider && next.decider && next.phase === 'playing') {
    const p = next.teamPoints || [];
    toast(t('🤝 Draw, {points} points each! Decider: one colour per team, teammates take turns rolling. First colour home wins!', { points: p[0] }), 'notice', 7000);
    sfx('win');
  }

  // New board or new game: start fresh. (playing → finished keeps going so the winning move animates.)
  const reset = !prev || prev.mode !== next.mode || (prev.phase !== next.phase && next.phase !== 'finished');
  if (reset) {
    events = [];
    current = null;
    shownTokens = latestTokens = next.tokens;
    lastMoveSeq = next.lastMove?.seq ?? 0;
    lastRollSeq = next.lastRoll?.seq ?? 0;
    rollPending = null;
    pendingRoll = null;
    dice = { mode: 'hidden' };
    celebrated = false;
    if (finishTimer) {
      clearTimeout(finishTimer);
      finishTimer = null;
    }
    if (next.phase === 'finished') {
      celebrated = true;
      showFinish();
    }
  } else {
    const queued = [];
    if (next.lastMove && next.lastMove.seq > lastMoveSeq) {
      const m = next.lastMove;
      const guess = current?.predicted ? current.move : null;
      if (guess && guess.seat === m.seat && guess.token === m.token && guess.from === m.from && guess.to === m.to) {
        // The move already hopping since the tap: it's confirmed, with what it captured
        current.predicted = false;
        current.move = m;
        current.final = next.tokens;
        current.duration = current.moveMs + (m.captured.length ? captureMs(m.captured, m.seat) : 120);
      } else {
        if (guess) {
          // Guessed wrong (shouldn't happen): drop the guess and play the real move from the start
          current = null;
          shownTokens = latestTokens;
        }
        queued.push({ seq: m.seq, ev: { type: 'move', move: m, start: latestTokens, final: next.tokens } });
      }
      lastMoveSeq = m.seq;
    }
    if (next.lastRoll && next.lastRoll.seq > lastRollSeq) {
      rollPending = null;
      pendingRoll = null;
      // 6s already kept this turn stay on show while the next roll tumbles
      const bank = prev.turn === next.turn && !prev.rolled ? prev.rolls || [] : [];
      queued.push({
        seq: next.lastRoll.seq,
        ev: { type: 'roll', seat: next.lastRoll.seat, value: next.lastRoll.value, values: next.lastRoll.values || [next.lastRoll.value], bank },
      });
      lastRollSeq = next.lastRoll.seq;
    }
    if (next.phase !== 'playing' || next.turn !== prev.turn || next.rolled) {
      rollPending = null;
      pendingRoll = null;
    }
    queued.sort((a, b) => a.seq - b.seq);
    for (const q of queued) events.push(q.ev);
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
    if (e.img) spawnBoardSticker(e);
    else floaters.push({ seat: e.seat, emoji: e.emoji, start: performance.now() });
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
let chatPrimed = false; // the room's earlier messages have been shown: anything after is new
let chatVersion = 0; // bumped when the chat must redraw anyway: a new room, a mute, colour-blind mode
let shownChatKey = '';

// People you muted: their chat and emotes are hidden, only for you. Kept on this device.
const muted = new Set(loadMuted());
const isHiddenUser = (userId) => muted.has(userId) || !!friendsData?.blocked?.includes(userId);
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
  renderLobbyChat();
  renderUI();
}

const STICKER_MS = 2800;

// Stickers float over their sender's base. They're placed from the board's current size, and
// placed again whenever the board resizes (on phones it shrinks while the keyboard is open, so
// a sticker sent then would otherwise be left stranded at the top when the board grows back).
const liveStickers = new Set();

function placeSticker(st) {
  const b = boardFor(state.mode).bases[st.seat];
  const rect = els.canvas.getBoundingClientRect();
  if (!b || !rect.width || !renderer.span) return;
  const wr = els.canvas.parentElement.getBoundingClientRect();
  const cell = rect.width / renderer.span;
  st.el.style.left = `${rect.left - wr.left + (b.x + renderer.span / 2) * cell}px`;
  st.el.style.top = `${rect.top - wr.top + (b.y + renderer.span / 2) * cell}px`;
  st.img.style.width = `${Math.round(cell * 2.6)}px`;
}

function spawnBoardSticker(e) {
  if (!boardFor(state.mode).bases[e.seat]) return;
  const el = document.createElement('div');
  el.className = 'board-sticker';
  const img = document.createElement('img');
  img.src = e.img;
  img.alt = '';
  el.appendChild(img);
  const st = { el, img, seat: e.seat };
  placeSticker(st);
  els.canvas.parentElement.appendChild(el);
  liveStickers.add(st);
  setTimeout(() => {
    el.remove();
    liveStickers.delete(st);
  }, STICKER_MS);
}

// (the board can also just move inside its box, so watch the box as well as the board)
const stickerWatch = new ResizeObserver(() => liveStickers.forEach(placeSticker));
stickerWatch.observe(els.canvas);
stickerWatch.observe(els.canvas.parentElement);

// ---- phones, during a game: the chat folds into one line under the board ----
let chatMin = true; // folded (only matters where the phone layout applies, while playing)
let chatUnread = 0;
const gameEl = document.getElementById('game');
// Is the chat folded right now? (the input is hidden then: by the fold, or by chat being off)
const chatFolded = () => {
  const input = els.chats[0]?.querySelector('.chat-form input');
  return !!input && getComputedStyle(input).display === 'none';
};
function setChatMin(min) {
  chatMin = min;
  gameEl.classList.toggle('chat-min', min);
  if (!min) chatUnread = 0;
  renderChatPeek(null, false);
}
gameEl.classList.add('chat-min');
for (const box of els.chats) {
  box.querySelector('[data-chat-peek]')?.addEventListener('click', () => setChatMin(false));
  box.querySelector('[data-chat-close]')?.addEventListener('click', () => setChatMin(true));
}

// The folded line: the newest message (name in their colour, stickers small) and how many came
// in since you last looked. `flash`: a new one just arrived.
function renderChatPeek(msgs, flash) {
  msgs ||= (state?.chat || []).filter((m) => !muted.has(m.userId));
  const last = [...msgs].reverse().find((m) => !m.system);
  const board = state && boardFor(state.mode);
  for (const box of els.chats) {
    const peek = box.querySelector('[data-chat-peek]');
    if (!peek) continue;
    const text = peek.querySelector('.peek-text');
    text.dir = 'auto';
    text.replaceChildren();
    if (!last) text.textContent = t('Chat');
    else {
      const who = document.createElement('b');
      const seat = state.seats.findIndex((x) => x && !x.bot && x.userId === last.userId);
      who.textContent = `${last.name}: `;
      if (seat >= 0) who.style.color = col(board.colors[seat]);
      text.appendChild(who);
      for (const part of last.text.split(/(:[a-z0-9-]+:)/g)) {
        const hit = EMOTE_SLUGS[/^:([a-z0-9-]+):$/.exec(part)?.[1]];
        if (hit) {
          const img = document.createElement('img');
          img.src = hit.img;
          img.alt = '';
          text.appendChild(img);
        } else if (part) text.appendChild(document.createTextNode(part));
      }
    }
    const count = peek.querySelector('.peek-count');
    count.textContent = chatUnread > 9 ? '9+' : String(chatUnread);
    count.classList.toggle('hidden', !chatUnread);
    if (flash && chatFolded()) {
      peek.classList.remove('fresh');
      void peek.offsetWidth; // (restart the animation)
      peek.classList.add('fresh');
    }
  }
}

function renderChat() {
  if (!state) return;
  // Each player can turn typed chat off for themselves (⚙ Settings → General); stickers still work
  for (const box of els.chats) renderTyping(box.querySelector('.typing-line'));
  const msgs = (state.chat || []).filter((m) => !muted.has(m.userId));
  const latest = msgs.at(-1)?.id || 0;
  const reactSig = msgs.map((m) => (m.reactions ? `${m.id}:${Object.entries(m.reactions).map(([e, u]) => `${e}${u.length}${u.includes(me?.id) ? 1 : 0}`).join(',')}` : '')).filter(Boolean).join('|');
  const key = `${chatVersion}|${latest}|${reactSig}`;
  if (key === shownChatKey) return;
  const onlyReactionsChanged = shownChatKey.startsWith(`${chatVersion}|${latest}|`);
  shownChatKey = key;
  const fromOthers = !onlyReactionsChanged && chatPrimed && latest > shownChatId && msgs.at(-1).userId !== me?.id;
  chatPrimed = true;
  if (prefs.chat && fromOthers) sfx('chat');
  if (fromOthers && chatFolded()) chatUnread += msgs.filter((m) => m.id > shownChatId && m.userId !== me?.id).length;
  shownChatId = latest;
  if (!onlyReactionsChanged) renderChatPeek(msgs, fromOthers);

  const board = boardFor(state.mode);
  for (const box of els.chats) {
    const list = box.querySelector('.chat-log');
    if (onlyReactionsChanged) {
      for (const m of msgs) {
        const line = list.querySelector(`.chat-line[data-msg-id="${m.id}"]`);
        if (line) syncLineReacts(line, m.reactions, (emoji) => send('react', { id: m.id, emoji }));
      }
      continue;
    }
    const readingAt = list.scrollTop; // kept when you're scrolled up reading
    // New messages are added to the end; the rest stay as they are. (Rebuilding the whole list
    // for every message made the chat flash on phones and restarted every animated sticker.)
    const fresh = list._ver !== chatVersion || !msgs.length || !list._lastId || !msgs.some((m) => m.id === list._lastId);
    if (fresh) {
      list.innerHTML = '';
      list._ver = chatVersion;
    } else {
      // messages that dropped out of the server's last-N window
      while (list.firstElementChild && Number(list.firstElementChild.dataset.id) < msgs[0].id) list.firstElementChild.remove();
    }
    if (!msgs.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = t('No messages yet. Say hi!');
      list.appendChild(li);
    }
    const after = fresh ? 0 : list._lastId;
    if (fresh) list._lastAt = 0;
    list._lastId = latest;
    const replyFn = (m) => setRoomReply(box, m);
    const reactFn = (m, emoji) => send('react', { id: m.id, emoji });
    for (const m of msgs) {
      if (m.id <= after) {
        const line = list.querySelector(`.chat-line[data-msg-id="${m.id}"]`);
        if (line) syncLineReacts(line, m.reactions, (emoji) => reactFn(m, emoji));
        continue;
      }
      const li = document.createElement('li');
      li.dataset.id = m.id;
      if (m.system) {
        // A note from the game itself (updates): no name, set apart from what players say
        li.className = 'system';
        li.textContent = translateServer(m.text);
        list.appendChild(li);
        continue;
      }
      // the time, centred, when a while has passed since the last message
      if (!list._lastAt || m.at - list._lastAt > 5 * 60_000) {
        const stamp = document.createElement('li');
        stamp.className = 'chat-time';
        stamp.dataset.id = m.id;
        stamp.textContent = new Date(m.at).toLocaleTimeString(document.documentElement.lang || undefined, { hour: '2-digit', minute: '2-digit' });
        list.appendChild(stamp);
      }
      list._lastAt = m.at;
      const seat = state.seats.findIndex((s) => s && !s.bot && s.userId === m.userId);
      const stickerOnly = isStickerOnly(m.text);
      const isMe = m.userId === me?.id;
      const prevLi = list.lastElementChild;
      const canGroup = !stickerOnly && !m.replyTo && prevLi?.classList.contains('chat-msg') && !prevLi.classList.contains('sticker-only') && prevLi.dataset.userId === m.userId;
      const line = buildChatLine({ msg: m, isMe, scope: 'room', logEl: list, stickerOnly, showTime: false, onReply: replyFn, onReact: reactFn });
      if (!fresh) line.classList.add('arrive'); // a new message slides in (not on a redraw)
      if (canGroup) {
        prevLi.querySelector('.chat-body')?.appendChild(line);
        prevLi.dataset.id = m.id;
        continue;
      }
      li.dataset.userId = m.userId;
      // The name on top, outside; the bubble under it, just as wide as what's said
      li.className = `chat-msg${isMe ? ' me' : ''}${m.vip ? ' vip' : ''}${stickerOnly ? ' sticker-only' : ''}`;
      if (seat >= 0) li.style.setProperty('--seat-col', col(board.colors[seat]));
      const who = document.createElement('button');
      who.type = 'button';
      who.className = 'who who-btn';
      who.textContent = (m.vip ? '👑 ' : '') + (seat >= 0 ? sym(board.colors[seat]) : '') + m.name;
      who.addEventListener('click', () => inspectPlayer(m.userId, m.name));
      // their picture (in their frame) beside the name and bubble
      const av = document.createElement('button');
      av.type = 'button';
      av.className = 'avatar chat-av';
      av.setAttribute('aria-label', m.name);
      fillAvatar(av, { id: m.userId, name: m.name, avatar: !String(m.userId).startsWith('guest-') });
      setFrame(av, m.frame || state.seats[seat]?.skins?.frame);
      av.addEventListener('click', () => inspectPlayer(m.userId, m.name));
      li.appendChild(av);
      const col2 = document.createElement('div');
      col2.className = 'chat-col';
      li.appendChild(col2);
      col2.appendChild(who);
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble';
      if (m.replyTo) appendReplyQuote(bubble, m.replyTo, list);
      const body = document.createElement('div');
      body.className = 'chat-body';
      body.appendChild(line);
      bubble.appendChild(body);
      col2.appendChild(bubble);
      list.appendChild(li);
    }
    if (list._pinned === false) list.scrollTop = readingAt;
    else keepAtBottom(list);
  }
}

// The chat stays scrolled to the newest message unless you scrolled up to read. Whether you're
// "at the bottom" is only decided by your own scrolling: on phones the box changes height all the
// time (the keyboard, the "typing…" line, the panel between turns, the chat hidden behind another
// screen), and measuring it at the moment a message arrived used to leave it stuck part-way up.
for (const box of els.chats) {
  const list = box.querySelector('.chat-log');
  list._pinned = true;
  list.addEventListener('scroll', () => {
    // A scroll that lands at the bottom (ours or yours) pins it; scrolling up unpins it.
    // Scrolls while the box is hidden or zero-height say nothing.
    if (!list.clientHeight) return;
    list._pinned = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  });
  // Any change of size (keyboard, layout, becoming visible): back to the bottom if pinned
  new ResizeObserver(() => keepAtBottom(list)).observe(list);
}

function keepAtBottom(list) {
  if (list._pinned !== false) list.scrollTop = list.scrollHeight;
}

// "Ann is typing…": each entry carries the server time it runs out, so it goes exactly then,
// however many other updates (rolls, moves) arrive in between.
function renderTyping(line) {
  clearTimeout(line._t);
  if (!state) return;
  const now = Date.now() + clockOffset;
  const live = (state.typing || []).filter((t) => t.id !== me?.id && !muted.has(t.id) && (t.until ?? now + 1) > now);
  const names = live.map((t) => t.name);
  const text = names.length > 1 ? t('{names} are typing…', { names: names.join(' & ') }) : names.length ? t('{name} is typing…', { name: names[0] }) : '';
  if (line.textContent !== text) line.textContent = text;
  if (live.length) line._t = setTimeout(() => renderTyping(line), Math.max(50, Math.min(...live.map((t) => t.until ?? now + 2500)) - now));
}

// The sticker picker: a row of tabs, one per pack you own (plus single stickers and your recent
// ones), and the chosen pack's stickers underneath. Clicking a sticker sends its :slug: code
// straight away — the server checks you own it when it arrives.
const RECENT_KEY = 'ludo-recent-stickers';
const RECENT_MAX = 12;
let pickerPack = null; // the tab last opened (kept between games)
try {
  pickerPack = localStorage.getItem('ludo-sticker-tab');
} catch {
  // no storage: start on the first tab
}

function recentStickers() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch {
    return [];
  }
}

function rememberSticker(insert) {
  const list = [insert, ...recentStickers().filter((x) => x !== insert)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // not saved: fine
  }
}

// [{ id, name, icon, entries: [{ img, name, insert }] }] for what this player owns
function stickerGroups() {
  const groups = [];
  const singles = [];
  const all = new Map();
  for (const i of SHOP_ITEMS) {
    if (!ownsItem(profile, i.id)) continue;
    if (i.type === 'emote' && i.img) singles.push({ img: i.img, name: i.name, insert: `:${i.slug}:` });
    else if (i.type === 'emote-pack') {
      const entries = i.emotes.map((e) => ({ img: e.img, name: e.name, insert: `:${e.slug}:` }));
      groups.push({ id: i.id, name: i.name, icon: entries[0]?.img, entries });
    }
  }
  for (const g of groups) for (const e of g.entries) all.set(e.insert, e);
  for (const e of singles) all.set(e.insert, e);
  // Single stickers first, then your recent ones, then the packs
  const recent = recentStickers().map((x) => all.get(x)).filter(Boolean);
  if (recent.length) groups.unshift({ id: 'recent', name: t('Recent'), icon: null, entries: recent });
  if (singles.length) groups.unshift({ id: 'singles', name: t('Stickers'), icon: singles[0].img, entries: singles });
  return groups;
}

// The game redraws on every update (each roll, move, "is typing"…), so the picker is only rebuilt
// when what it shows has changed: otherwise it would jump back to the top while you scroll it.
let pickerShown = '';
function renderEmojiPops() {
  const groups = stickerGroups();
  const current = pickedGroup(groups);
  const key = JSON.stringify([current?.id, groups.map((g) => [g.id, g.entries.map((e) => e.insert)])]);
  if (key === pickerShown) return;
  pickerShown = key;
  for (const box of els.chats) renderEmojiPop(box, groups, current, (text) => send('chat', { text }));
  const lobbyBox = $('lobby-chat');
  if (lobbyBox) renderEmojiPop(lobbyBox, groups, current, sendActiveLobbyOrDm);
}

function pickedGroup(groups) {
  return groups.find((g) => g.id === pickerPack) || groups.find((g) => g.id !== 'recent') || groups[0];
}

function renderEmojiPop(box, groups, current, onPick) {
  const pop = box.querySelector('.emoji-pop');
  pop.innerHTML = '';
  if (!groups.length) {
    const hint = document.createElement('p');
    hint.className = 'emoji-empty';
    hint.textContent = t('No stickers yet — find packs in the Shop');
    pop.appendChild(hint);
    return;
  }
  // The pack tabs
  const tabs = document.createElement('div');
  tabs.className = 'emoji-tabs';
  for (const g of groups) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = `emoji-tab${g === current ? ' active' : ''}`;
    tab.title = t(g.name);
    tab.setAttribute('aria-label', t(g.name));
    if (g.icon) {
      const img = document.createElement('img');
      img.src = g.icon;
      img.alt = '';
      tab.appendChild(img);
    } else tab.textContent = '🕘';
    tab.addEventListener('click', () => {
      pickerPack = g.id;
      try {
        localStorage.setItem('ludo-sticker-tab', g.id);
      } catch {
        // fine
      }
      renderEmojiPops();
    });
    tabs.appendChild(tab);
  }
  pop.appendChild(tabs);

  const label = document.createElement('div');
  label.className = 'emoji-pack-name';
  label.textContent = current.name;
  pop.appendChild(label);

  // The chosen pack's stickers
  const grid = document.createElement('div');
  grid.className = 'emoji-grid';
  for (const e of current.entries) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'emote';
    b.title = e.name;
    const img = document.createElement('img');
    img.src = e.img;
    img.alt = e.name;
    img.loading = 'lazy';
    b.appendChild(img);
    b.addEventListener('click', () => {
      // Tap = send: the sticker goes straight to chat (and floats over your base in a room).
      onPick(e.insert);
      pop.classList.add('hidden');
      rememberSticker(e.insert);
      renderEmojiPops(); // so Recent is up to date next time
    });
    grid.appendChild(b);
  }
  pop.appendChild(grid);
  fitPicker(pop); // a bigger pack needs more room: keep it above the button
}

// The picker floats just above its sticker button, positioned against the screen rather than
// inside the chat box (which clips what spills out of it). It stays within the visible part of
// the screen (short phones, the keyboard up) by letting its sticker grid shrink and scroll.
function fitPicker(pop) {
  if (pop.classList.contains('hidden')) return;
  const btn = pop.parentElement.querySelector('[data-emoji-btn]');
  const form = pop.parentElement.querySelector('.chat-form') || btn;
  const br = btn.getBoundingClientRect();
  const fr = form.getBoundingClientRect();
  const vv = window.visualViewport;
  const ceiling = (vv ? vv.offsetTop : 0) + 8;
  const floor = br.top - 6;
  Object.assign(pop.style, { position: 'fixed', right: 'auto', bottom: 'auto', top: '0px', maxHeight: '' });
  pop.style.maxHeight = `${Math.max(120, Math.min(340, Math.floor(floor - ceiling)))}px`;
  pop.style.top = `${Math.max(ceiling, floor - pop.offsetHeight)}px`;
  const width = pop.offsetWidth;
  const viewW = vv ? vv.offsetLeft + vv.width : window.innerWidth;
  pop.style.left = `${Math.max(8, Math.min(fr.right - width, viewW - width - 8))}px`;
}
const refitPickers = () => document.querySelectorAll('.emoji-pop:not(.hidden)').forEach(fitPicker);
window.visualViewport?.addEventListener('resize', refitPickers);
window.addEventListener('resize', refitPickers);
window.visualViewport?.addEventListener('scroll', refitPickers);
// the page or a panel scrolled under it (but not the picker's own sticker list)
document.addEventListener('scroll', (e) => e.target.closest?.('.emoji-pop') || refitPickers(), true);

const TOUCH = matchMedia('(hover: none) and (pointer: coarse)').matches; // phones and tablets

let lastTypingSent = 0;
function stopTyping() {
  if (!lastTypingSent) return;
  lastTypingSent = 0;
  send('typing', { on: false });
}

function wireEmojiToggle(box) {
  if (!box) return;
  const pop = box.querySelector('.emoji-pop');
  const emojiBtn = box.querySelector('[data-emoji-btn]');
  if (!pop || !emojiBtn) return;
  emojiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    pop.classList.toggle('hidden');
    fitPicker(pop);
  });
  // Tapping the sticker button, a pack tab or a sticker mustn't take focus from the text box:
  // that closed the phone keyboard (and the layout jumped back), then reopened it.
  for (const el of [emojiBtn, pop]) {
    for (const ev of ['pointerdown', 'mousedown']) {
      el.addEventListener(ev, (e) => {
        if (e.target.closest('button')) e.preventDefault();
      });
    }
  }
}

for (const box of els.chats) {
  const form = box.querySelector('form');
  const input = box.querySelector('input');
  wireEmojiToggle(box);
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
    // Emptied the box: tell the others straight away. Otherwise a "still typing" ping every second.
    if (!input.value) return stopTyping();
    const now = performance.now();
    if (now - lastTypingSent > 1000) {
      lastTypingSent = now;
      send('typing');
    }
  });
  input.addEventListener('blur', () => {
    if (input.value) stopTyping(); // left the box half-written
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
    const replyId = box._reply?.id || null;
    send('chat', replyId ? { text, replyId } : { text });
    setRoomReply(box, null);
    input.value = '';
    lastTypingSent = 0; // the server clears "typing" when the message arrives
    updateCount();
    // Sending always takes you down to the newest messages
    const list = box.querySelector('.chat-log');
    list._pinned = true;
    keepAtBottom(list);
    if (document.documentElement.classList.contains('kb-open')) input.focus({ preventScroll: true });
  });
  input.addEventListener('keydown', (e) => e.key === 'Escape' && box._reply && setRoomReply(box, null));
}

// Coming back to the app: phones (iPhones especially) may have thrown away the board's drawing
// while it was in the background, so it's drawn again from scratch.
const redrawBoard = () => {
  renderer.size = 0;
  boardBox = 0; // measured again too
};
// Back from another tab (or a minimised window): the browser paused the animations while the
// game carried on, so everything that happened meanwhile is queued up. Replaying it all at once
// (rolls, hops, sounds) looked like the game going haywire: jump straight to where it is now.
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = performance.now();
    return;
  }
  catchUp(performance.now() - hiddenAt);
  redrawBoard();
});
function catchUp(away) {
  lastFrame = 0; // the next frame counts as a normal one, not one huge step
  if (away < 1000 || !state) return;
  if (current || events.length) skipAnimations();
  floaters = [];
}
window.addEventListener('pageshow', redrawBoard);

// Tapping in a chat log (a message, Reply, React, the AI chip) while typing mustn't take focus from
// the chat box: that closes the phone keyboard and the whole chat jumps down and back up. The tap
// itself still works (it's the click that does things, not the focus).
document.addEventListener(
  'pointerdown',
  (e) => {
    const typing = document.activeElement?.matches?.('.chat-form input');
    if (!typing || e.pointerType === 'mouse') return;
    const inLog = e.target.closest?.('.chat-log');
    if (inLog && !e.target.closest('input, textarea, select, .tr-rate-link')) e.preventDefault();
  },
  true,
);
// a tap anywhere else hides the Reply / React a tap showed
document.addEventListener('click', (e) => {
  if (!e.target.closest?.('.chat-line')) for (const l of document.querySelectorAll('.chat-line.acts-on')) l.classList.remove('acts-on');
});

// ---------------- phones: the on-screen keyboard ----------------
// While someone types on a phone, the game is pinned to the part of the screen above the
// keyboard (the visual viewport): the board shrinks and the chat box sits right on top of the
// keyboard. Without this the browser scrolls the page to keep the box in view while the layout
// resizes under it, and everything jumps about.
if (matchMedia('(hover: none) and (pointer: coarse)').matches) {
  const root = document.documentElement;
  const vv = window.visualViewport;
  const isChat = (el) => !!el?.matches?.('.chat-form input');
  // Once a frame at most, and only when the visible area really changed: the keyboard sends a
  // stream of resize/scroll events while it slides, and re-laying the game out for each one made
  // it shudder.
  let fitQueued = false;
  let shown = '';
  const applyKbVars = (allowClose = true) => {
    const h = Math.round(vv ? vv.height : window.innerHeight);
    const top = Math.round(vv ? vv.offsetTop : 0);
    // The keyboard went away but the box kept its focus (iPhones do this when you swipe it
    // down, or leave the app and come back): leave typing mode, or the game stays squeezed
    // into the top of the screen with the board gone.
    if (allowClose && h > fullH - 24) {
      if (kbSeen || performance.now() - openedAt > 1500) return closeKeyboardMode();
    } else if (h <= fullH - 100) kbSeen = true;
    // When the browser already resizes the layout viewport (Android interactive-widget=resizes-content),
    // CSS height: 100% tracks the keyboard animation smoothly without JS chasing every frame.
    const resizedByBrowser = Math.abs(h - window.innerHeight) <= 4 && top === 0;
    const key = resizedByBrowser ? '100%|0' : `${h}|${top}`;
    if (key === shown) return;
    shown = key;
    root.style.setProperty('--kb-h', resizedByBrowser ? '100%' : `${h}px`);
    root.style.setProperty('--kb-top', `${top}px`);
    if (screen === 'menu') $('menu').scrollTop = 0;
    const chatLog = $(screen === 'menu' ? 'lobby-chat-log' : 'chat-log');
    if (chatLog && chatLog._pinned !== false) requestAnimationFrame(() => { chatLog.scrollTop = chatLog.scrollHeight; });
  };
  const fit = () => {
    if (fitQueued) return;
    fitQueued = true;
    requestAnimationFrame(() => {
      fitQueued = false;
      if (!root.classList.contains('kb-open')) return;
      applyKbVars(true);
    });
  };
  let fullH = 0; // the visible height before the keyboard came up
  let kbSeen = false;
  let openedAt = 0;
  const closeKeyboardMode = () => {
    if (!root.classList.contains('kb-open')) return;
    root.classList.remove('kb-open');
    shown = '';
    root.style.removeProperty('--kb-pad-top');
    if (isChat(document.activeElement)) document.activeElement.blur();
    window.scrollTo(0, 0); // iPhones leave the page scrolled after the keyboard goes
  };
  document.addEventListener('focusin', (e) => {
    if (!isChat(e.target) || (screen !== 'game' && screen !== 'menu')) return;
    if (!root.classList.contains('kb-open')) {
      fullH = Math.round(vv ? vv.height : window.innerHeight);
      kbSeen = false;
      openedAt = performance.now();
      const activeScreen = $(screen);
      if (activeScreen) root.style.setProperty('--kb-pad-top', getComputedStyle(activeScreen).paddingTop);
    }
    shown = '';
    applyKbVars(false);
    root.classList.add('kb-open');
    setTimeout(fit, 1600); // no keyboard showed up at all (e.g. a keyboard plugged in): back to normal
  });
  // Leaving the app (or the tab) always ends typing mode
  document.addEventListener('visibilitychange', () => document.hidden && closeKeyboardMode());
  window.addEventListener('pagehide', closeKeyboardMode);
  document.addEventListener('focusout', (e) => {
    if (!isChat(e.target)) return;
    // Focus moves for a moment when an emoji is picked: only close if it really left the chat
    setTimeout(() => {
      if (!isChat(document.activeElement)) closeKeyboardMode();
    }, 150);
  });
  vv?.addEventListener('resize', fit);
  vv?.addEventListener('scroll', fit);
}

// "● 12 players online · 3 games in progress" at the top of the menu
let lastOnline = null;
function renderOnline({ online, games } = lastOnline || {}) {
  if (!Number.isFinite(online)) return;
  lastOnline = { online, games };
  const people = online === 1 ? t('1 player online') : t('{n} players online', { n: online });
  const playing = games ? ` · ${games === 1 ? t('1 game in progress') : t('{n} games in progress', { n: games })}` : '';
  els.onlineText.innerHTML = `<span class="online-dot"></span><b>${people}</b>${playing}`;
  els.onlineStrip.classList.remove('hidden');
}

// ---------------- leaderboards ----------------

let lbData = null; // { week, month } from the server, fetched when the menu shows (and every minute there)
let lbAsked = 0;
function fetchLeaderboard() {
  if (ws?.readyState !== WebSocket.OPEN || Date.now() - lbAsked < 5000) return;
  lbAsked = Date.now();
  ws.send(JSON.stringify({ type: 'leaderboard' }));
}
setInterval(() => screen === 'menu' && !document.hidden && ((lbAsked = 0), fetchLeaderboard()), 60_000);
let lbTab = 'week';

for (const b of els.lbTabs) {
  b.addEventListener('click', () => {
    lbTab = b.dataset.lb;
    renderLeaderboard();
  });
}

// '2026-11' → "November 2026", in the player's language
function sinceLabel(id) {
  const [y, m] = String(id || '').split('-').map(Number);
  if (!y || !m) return String(id || '');
  try {
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(document.documentElement.lang || undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  } catch {
    return id;
  }
}

// "3d 14h" / "5h 20m" / "12m"
function timeLeft(ms) {
  const m = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d) return t('{d}d {h}h', { d, h });
  if (h) return t('{h}h {m}m', { h, m: m % 60 });
  return t('{m}m', { m: m % 60 });
}

function renderLeaderboard() {
  for (const b of els.lbTabs) b.classList.toggle('active', b.dataset.lb === lbTab);
  const body = els.lbBody;
  const b = lbData?.[lbTab];
  if (!b) {
    body.innerHTML = `<p class="lb-note">${t('Loading…')}</p>`;
    return;
  }
  const week = lbTab === 'week';
  const all = lbTab === 'all';
  const pointsMode = b.mode === 'points';
  const coin = '<span class="coin"></span>';
  const lang = document.documentElement.lang || undefined;
  const chips = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString(lang)}`;
  const scoreHtml = (n) => (pointsMode ? `${Number(n).toLocaleString(lang)} <small>${t('pts')}</small>` : `${coin}${chips(n)}`);
  // The podium: 2nd, 1st, 3rd (1st in the middle, highest); empty places wait for someone
  const slot = (place) => {
    const e = b.top[place - 1];
    const prize = !all && b.prizes ? `<span class="pod-prize">${coin}${b.prizes[place - 1]}</span>` : '';
    if (!e) return `<div class="pod pod${place} empty"><div class="pod-pic"><span>?</span></div><b class="pod-name">—</b>${prize}<div class="pod-step"><span>${place}</span></div></div>`;
    return `<div class="pod pod${place}${e.you ? ' you' : ''}">
        <div class="pod-pic"><span class="avatar pod-avatar" data-lb-avatar="${place}"></span><img src="/frames/frame-rank-${place}.webp" alt="" class="pod-frame"></div>
        <b class="pod-name">${escapeHtml(e.name)}${e.you ? ` <small>${t('(you)')}</small>` : ''}</b>
        <span class="pod-chips${!pointsMode && e.points < 0 ? ' neg' : ''}">${scoreHtml(e.points)}</span>
        ${prize}
        <div class="pod-step"><span>${place}</span></div>
      </div>`;
  };
  const podium = `<div class="lb-podium">${slot(2)}${slot(1)}${slot(3)}</div>`;
  const row = (e, mine) => `<li class="lb-row${mine ? ' you' : ''}">
      <span class="lb-rank">${e.rank}</span>
      <span class="lb-name"><span class="avatar lb-avatar" data-lb-avatar="r${e.rank}"></span><span class="lb-name-text">${escapeHtml(e.name)}${mine ? ` <small>${t('(you)')}</small>` : ''}</span></span>
      <b class="lb-pts${!pointsMode && e.points < 0 ? ' neg' : ''}">${scoreHtml(e.points)}</b>
    </li>`;
  let rows = b.top.slice(3).map((e) => row(e, e.you)).join('');
  if (b.me && b.me.rank > b.top.length) rows += `<li class="lb-gap">⋯</li>${row({ ...b.me, id: me?.id, avatar: me?.avatar, name: me?.name || t('You') }, true)}`;
  const list = rows ? `<ol class="lb-list">${rows}</ol>` : '';
  const upcomingAll = all && b.startsAt && b.startsAt > Date.now() + clockOffset;
  const empty = !b.top.length
    ? (upcomingAll ? `<p class="lb-empty">${t('Coming soon')} — ${escapeHtml(sinceLabel(b.since))}</p>` : pointsMode ? '' : `<p class="lb-empty">${t('Nobody yet. Win a public stakes game to be first on the board.')}</p>`)
    : '';
  const yours = b.me
    ? t("You're <b>{place}</b> of {players}.", { place: ordinal(b.me.rank), players: b.players })
    : b.top.length ? (all ? t("You're not on the board yet.") : week ? t("You're not on the board yet this week.") : t("You're not on the board yet this month.")) : '';
  const how = pointsMode
    ? `${t("Every game against other people also scores leaderboard points: 10 for each player you finish ahead of, plus 10 for beating them all (bots don't count). Only games count for the leaderboards. The top 3 each week win 300 / 200 / 100 coins, and each month 1000 / 600 / 300.")} <b>${t('From 1 December, the leaderboards rank Gold Coins won in public stakes rooms instead.')}</b>`
    : `${t('Ranked by Gold Coins won in public stakes rooms: what you win minus your stake. Bots, private rooms and the shop never count.')} ${t('All In games count 1.5×, for wins and for losses.')}`;
  const when = all
    ? t('Never resets · counting since {date}', { date: escapeHtml(sinceLabel(b.since)) })
    : week
      ? t('Top 3 win coins when the week ends · resets in <b>{time}</b>', { time: timeLeft(b.endsAt - (Date.now() + clockOffset)) })
      : t('Top 3 win coins when the month ends · resets in <b>{time}</b>', { time: timeLeft(b.endsAt - (Date.now() + clockOffset)) });
  const lastPts = b.last?.unit === 'pts' || pointsMode;
  const last = !all && b.last?.podium?.length
    ? `<section class="lb-last"><h3>${week ? t("Last week's winners") : t("Last month's winners")}</h3><ol>${b.last.podium
        .map((p) => `<li>${MEDALS[p.place - 1]} ${escapeHtml(p.name)} <span>${lastPts ? `${Number(p.points).toLocaleString(lang)} ${t('pts')}` : `${coin}${chips(p.points)}`} · ${t('prize')} +${p.coins}</span></li>`)
        .join('')}</ol></section>`
    : '';
  body.innerHTML = `
    ${podium}
    ${empty}
    ${list}
    ${yours ? `<p class="lb-you">${yours}</p>` : ''}
    <p class="lb-note">${when}</p>
    <p class="lb-note lb-how">${how}</p>
    ${last}`;
  for (const av of body.querySelectorAll('[data-lb-avatar]')) {
    const key = av.dataset.lbAvatar;
    const person = key.startsWith('r')
      ? (b.top.find((e) => `r${e.rank}` === key) || (b.me && { id: me?.id || 'me', name: me?.name || t('You'), avatar: me?.avatar }))
      : b.top[Number(key) - 1];
    if (person) fillAvatar(av, person.id ? person : { id: person.name || key, name: person.name, avatar: false });
  }
}

// ---------------- daily quests ----------------

let weeklyData = null; // the same shape, for this week's quests (from Monday, UTC)
let questTab = 'day';
let questData = null; // { day, endsAt, quests: [{ title, goal, progress, points, done, tier }], bonus }

const QUEST_ICONS = {
  game: '<path d="M6 21V4M6 4.5h11l-2.5 4 2.5 4H6" />',
  six: '<rect x="4" y="4" width="16" height="16" rx="3.5" /><circle cx="9" cy="8.5" r=".9" /><circle cx="15" cy="8.5" r=".9" /><circle cx="9" cy="12" r=".9" /><circle cx="15" cy="12" r=".9" /><circle cx="9" cy="15.5" r=".9" /><circle cx="15" cy="15.5" r=".9" />',
  home: '<path d="M4 11.5 12 4.5l8 7M6.5 9.5V19.5h11V9.5M10 19.5v-5h4v5" />',
  out: '<path d="M11 4.5H5.5v15H11M9.5 12h10M15.5 8l4 4-4 4" />',
  capture: '<circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1.2" />',
  top2: '<circle cx="12" cy="14.5" r="5.5" /><path d="M9 9.5 6.5 3.5h4l1.5 3.5 1.5-3.5h4L15 9.5M12 12v5" />',
  win: '<path d="M7.5 4.5h9v4a4.5 4.5 0 0 1-9 0zM7.5 6H4.5a3 3 0 0 0 3 3.5M16.5 6h3a3 3 0 0 1-3 3.5M12 13v3.5M8.5 20h7l-1-3.5h-5z" />',
};
const TIER_NAMES = { 1: 'Easy', 2: 'Medium', 3: 'Hard' };

let questsOpen = (() => {
  try {
    return localStorage.getItem('ludo-quests-open') === '1';
  } catch {
    return false;
  }
})();
$('quest-summary').addEventListener('click', () => {
  questsOpen = !questsOpen;
  try {
    localStorage.setItem('ludo-quests-open', questsOpen ? '1' : '0');
  } catch {}
  renderQuests();
});

function renderQuests() {
  if (!questData) return;
  els.todayCard.classList.remove('hidden');
  // The folded line: today's quests done, and the coins still to earn
  const doneN = questData.quests.filter((q) => q.done).length;
  const toEarn = questData.quests.reduce((n, q) => n + (q.done ? 0 : q.coins), 0) + (questData.bonus.done ? 0 : questData.bonus.coins);
  $('quest-summary-text').textContent = t('{n} of {total} done today', { n: doneN, total: questData.quests.length });
  $('quest-summary-pill').innerHTML = toEarn ? `<span class="coin"></span> +${toEarn}` : '✓';
  $('quest-summary-pill').classList.toggle('done', !toEarn);
  $('quest-summary').setAttribute('aria-expanded', String(questsOpen));
  els.todayCard.classList.toggle('quests-open', questsOpen);
  const left = (d) => timeLeft(d.endsAt - (Date.now() + clockOffset));
  els.questsReset.textContent = t('new in {time}', { time: left(questData) });
  if (!weeklyData) questTab = 'day';
  $('quest-tabs').classList.toggle('hidden', !weeklyData);
  for (const b of $('quest-tabs').children) b.classList.toggle('active', b.dataset.qtab === questTab);
  const data = questTab === 'week' ? weeklyData : questData;
  $('quests-reset-q').textContent = questTab === 'week' ? t('new in {time}', { time: left(data) }) : '';
  els.questList.innerHTML = data.quests
    .map((q) => {
      const pct = Math.round((100 * q.progress) / q.goal);
      return `<li class="today-row tier${q.tier}${q.done ? ' done' : ''}">
        <span class="today-icon"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${QUEST_ICONS[q.stat] || QUEST_ICONS.game}</svg></span>
        <div class="today-main">
          <span class="today-kicker">${escapeHtml(t(TIER_NAMES[q.tier] || 'Medium'))}</span>
          <b>${escapeHtml(t(q.title))}</b>
          <div class="today-bar"><span><i style="width:${pct}%"></i></span><em>${q.progress}/${q.goal}</em></div>
        </div>
        <span class="reward-pill${q.done ? ' done' : ''}">${q.done ? '✓' : '<span class="coin"></span>'} +${q.coins}</span>
      </li>`;
    })
    .join('');
  const b = data.bonus;
  if (questTab === 'week')
    els.questsBonus.innerHTML = b.done
      ? `🎉 ${t('All done this week: <b>+{coins} coins</b> bonus earned', { coins: b.coins })}`
      : t('Finish all three this week for a <b>+{coins} coins</b> bonus · only games against other people count', { coins: b.coins });
  else
    els.questsBonus.innerHTML = b.done
      ? `🎉 ${t('All done today: <b>+{coins} coins</b> bonus earned', { coins: b.coins })}`
      : t('Finish all three for a <b>+{coins} coins</b> bonus · only games against other people count', { coins: b.coins });
}
// Keep the "new in …" countdown current, and fetch the new day's quests after midnight
setInterval(() => {
  if (!questData) return;
  const now = Date.now() + clockOffset;
  if ((now >= questData.endsAt || (weeklyData && now >= weeklyData.endsAt)) && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'quests' }));
  renderQuests();
}, 60_000);

function showQuestsDone(completed) {
  toast(completed.map((c) => `${c.bonus ? '🎉' : '✅'} ${t(c.title)} · +${c.coins} 🪙`).join('   '), 'ok', 5000);
  quietCoinsUntil = Date.now() + 3000; // the coins arrive next: this toast already said so
  sfx('home');
}

// Prizes won (told once, when you next connect)
// "Join our Discord server": shown once per launch, until they join or tick "Don't ask again".
function showInvite(url) {
  if (inviteShown) return; // reconnects in the same launch don't bring it back
  inviteShown = true;
  const card = $('invite-card');
  const answer = (value) => {
    card.classList.add('hidden');
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'invite', answer: value }));
  };
  $('invite-join').onclick = () => {
    // Inside Discord, invite links open Discord's own "Join server" window
    if (discordSdk) discordSdk.commands.openExternalLink({ url }).catch(() => {});
    else window.open(url, '_blank', 'noopener');
    answer('join');
  };
  $('invite-no').onclick = () => answer('later');
  $('invite-never').onclick = () => answer('never');
  card.classList.remove('hidden');
}

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
    if (b.classList.contains('switch')) b.setAttribute('aria-checked', String(on));
    else {
      b.textContent = on ? t('On') : t('Off');
      b.classList.toggle('off', !on);
    }
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

// ---------------- music player ----------------

const popOpenFor = { btn: null };

function renderPlayer() {
  const s = audioSettings();
  const list = s.tracks || [];
  // The track section only exists once sounds.json has loaded a playlist; the volumes always show.
  for (const el of [$('player-now'), $('player-controls'), els.playerList]) el.classList.toggle('hidden', list.length === 0);
  const cur = list.find((t) => t.id === s.musicTrack) || list[0];
  const song = s.song || cur;
  els.playerLabel.textContent = cur ? t(cur.label) + (s.song?.of > 1 ? ` · ${s.song.n}/${s.song.of}` : '') : '';
  els.playerTitle.textContent = song ? [song.title, song.artist].filter(Boolean).join(' — ') : '';
  els.playerPlay.textContent = s.music ? '⏸' : '▶';
  els.playerList.innerHTML = '';
  for (const trk of list) {
    const b = document.createElement('button');
    b.className = trk === cur ? 'active' : '';
    b.innerHTML = `${escapeHtml(t(trk.label))}<small>${trk.songs > 1 ? escapeHtml(t('{n} songs', { n: trk.songs })) : escapeHtml([trk.title, trk.artist].filter(Boolean).join(' — '))}</small>`;
    b.addEventListener('click', () => playTrack(trk.id));
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
  const popWidth = Math.min(280, window.innerWidth - 16);
  let right = window.innerWidth - r.right;
  // If aligning to button right pushes popover off left edge (left < 8px), clamp right:
  if (window.innerWidth - right - popWidth < 8) {
    right = window.innerWidth - popWidth - 8;
  }
  right = Math.max(8, right);
  els.playerPop.style.top = `${r.bottom + 6}px`;
  els.playerPop.style.right = `${Math.round(right)}px`;
  els.playerPop.style.left = 'auto';
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
    closeSupport();
    closeSettings();
    closeInbox();
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

// ---------------- how to play: one section at a time ----------------

let howtoTab = 'start';
function renderHowtoTabs() {
  const nav = $('howto-tabs');
  nav.innerHTML = '';
  for (const sec of document.querySelectorAll('.howto-sec')) {
    const b = document.createElement('button');
    b.className = `tab${sec.dataset.howto === howtoTab ? ' active' : ''}`;
    b.setAttribute('role', 'tab');
    b.textContent = sec.querySelector('h3').textContent;
    b.addEventListener('click', () => {
      howtoTab = sec.dataset.howto;
      renderHowtoTabs();
    });
    nav.appendChild(b);
    sec.classList.toggle('active', sec.dataset.howto === howtoTab);
  }
}
renderHowtoTabs();
window.addEventListener('ludo-lang', renderHowtoTabs);
$('replay-tour')?.addEventListener('click', openTour);

// ---------------- settings popup ----------------

const settingsEl = $('settings');
let settingsTab = 'general';
const SETTINGS_TITLES = { general: 'General', language: 'Language', sound: 'Sound', display: 'Display', help: 'Help' };
function showSettingsTab(tab) {
  settingsTab = tab;
  for (const b of document.querySelectorAll('[data-set-tab]')) b.classList.toggle('active', b.dataset.setTab === tab);
  for (const p of document.querySelectorAll('[data-set-page]')) p.classList.toggle('active', p.dataset.setPage === tab);
  $('settings-title').textContent = t(SETTINGS_TITLES[tab]);
}
function openSettings(tab = settingsTab) {
  closePlayer();
  renderCbPicker();
  renderLangList();
  renderPrefs();
  showSettingsTab(tab);
  settingsEl.classList.remove('hidden');
  $('settings-close').focus();
}
function closeSettings() {
  settingsEl.classList.add('hidden');
}
for (const b of document.querySelectorAll('[data-settings-btn]')) b.addEventListener('click', () => openSettings());
for (const b of document.querySelectorAll('[data-set-tab]')) b.addEventListener('click', () => showSettingsTab(b.dataset.setTab));
$('settings-close').addEventListener('click', closeSettings);
settingsEl.addEventListener('pointerdown', (e) => e.target === settingsEl && closeSettings());
$('howto-open').addEventListener('click', () => {
  closeSettings();
  showScreen('howto');
});

// Your own preferences (this device): the game chat can be hidden.
const PREFS_KEY = 'ludo-prefs';
const prefs = { chat: true, taunts: true, lighting: true };
try {
  Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'));
} catch {
  // storage unavailable: defaults
}
function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // only a preference
  }
}
function applyPrefs() {
  document.body.classList.toggle('no-chat', !prefs.chat);
}
function renderPrefs() {
  $('pref-chat').setAttribute('aria-checked', String(prefs.chat));
  $('pref-taunts').setAttribute('aria-checked', String(prefs.taunts));
  $('pref-lighting').setAttribute('aria-checked', String(prefs.lighting));
  setSceneLighting(prefs.lighting);
  renderSceneSeg();
  $('pref-invites').setAttribute('aria-checked', String(friendsData?.invitesOn !== false));
}
$('pref-chat').addEventListener('click', () => {
  prefs.chat = !prefs.chat;
  savePrefs();
  applyPrefs();
  renderPrefs();
  if (lchat.open) lobbyChatPanel(true);
});
$('pref-taunts').addEventListener('click', () => {
  prefs.taunts = !prefs.taunts;
  savePrefs();
  if (!prefs.taunts) renderer.clearTaunts();
  renderPrefs();
});
// Time of day for lit boards (Sakura): also picked on the board's page in the shop
function renderSceneSeg() {
  const seg = $('pref-scene');
  seg.classList.toggle('hidden', !prefs.lighting);
  for (const b of seg.querySelectorAll('[data-scene]')) {
    const on = b.dataset.scene === sceneSwitch.mode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  }
}
for (const b of document.querySelectorAll('[data-scene]')) b.addEventListener('click', () => setSceneMode(b.dataset.scene));
window.addEventListener('ludo-scene-mode', renderSceneSeg);
$('pref-lighting').addEventListener('click', () => {
  prefs.lighting = !prefs.lighting;
  savePrefs();
  renderPrefs();
  menuBoardKey = null; // (the menu's board repaints too)
  drawMenuBoard();
});
$('pref-invites').addEventListener('click', () => {
  const on = friendsData?.invitesOn === false;
  if (friendsData) friendsData.invitesOn = on;
  renderPrefs();
  ws?.send(JSON.stringify({ type: 'friend', op: 'invites', on }));
});
applyPrefs();

// ---------------- language ----------------

// A language's name in the language the game is shown in, from the browser (e.g. "Spanish", "espagnol")
function languageName(code) {
  try {
    return new Intl.DisplayNames([currentLang()], { type: 'language' }).of(code === 'zh' ? 'zh-Hans' : code);
  } catch {
    return null;
  }
}

// The chat language (Settings → Language, under the game's languages): 37 to pick from
function renderChatLangPick() {
  const sel = $('chat-lang');
  if (!sel) return;
  const pref = chatLanguagePref();
  sel.innerHTML = '';
  const auto = document.createElement('option');
  auto.value = 'auto';
  auto.textContent = `${t('Automatic')} (${langName(chatLanguage())})`;
  sel.appendChild(auto);
  const named = CHAT_LANGUAGES.map((l) => ({ ...l, mine: languageName(l.code === 'zh-TW' ? 'zh-Hant' : l.code) || '' }));
  for (const l of named.sort((a, b) => a.native.localeCompare(b.native))) {
    const o = document.createElement('option');
    o.value = l.code;
    o.textContent = l.mine && l.mine.toLowerCase() !== l.native.toLowerCase() ? `${l.native} · ${l.mine}` : l.native;
    o.selected = l.code === pref;
    sel.appendChild(o);
  }
}

// Tell the server (it guesses what your messages are written in from it), and move to the new
// language channel if the chat is open
let chatLangSent = null;
function sendChatLang() {
  if (ws?.readyState !== WebSocket.OPEN) return;
  const code = chatLanguage();
  if (code === chatLangSent) return;
  chatLangSent = code;
  ws.send(JSON.stringify({ type: 'chatLang', lang: code }));
  if (lchat.open && lchat.lang !== code) lobbyChatJoin();
  $('lobby-chat-lang').textContent = langName(code);
}
$('chat-lang')?.addEventListener('change', (e) => setChatLanguage(e.target.value));
window.addEventListener('ludo-chat-lang', () => {
  renderChatLangPick();
  sendChatLang();
  renderLobbyChat();
});

function renderLangList() {
  renderChatLangPick();
  const list = $('lang-list');
  const pref = languagePref();
  list.innerHTML = '';
  const options = [{ code: 'auto', native: t('Automatic'), name: t('Same as Discord') }, ...LANGUAGES];
  for (const l of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `${l.code === pref ? 'active' : ''}${l.code === 'auto' ? ' auto' : ''}`;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(l.code === pref));
    b.lang = l.code === 'auto' ? '' : l.code;
    b.innerHTML = `<b></b><small></small>`;
    b.querySelector('b').textContent = l.native;
    b.querySelector('small').textContent = l.code === 'auto' ? l.name : languageName(l.code) || l.name;
    b.addEventListener('click', () => setLanguage(l.code));
    list.appendChild(b);
  }
}

// The language changed: everything drawn by code is drawn again in it.
// Discord's prices arrived: gem prices can show what they are in money
window.addEventListener('ludo-prices', () => screen === 'shop' && drawShop());
window.addEventListener('ludo-lang', () => {
  sendChatLang();
  chatVersion++;
  renderOnline();
  pickerShown = '';
  els.modePicker.dataset.key = '';
  renderUI();
  if (state) renderChat();
  renderQuests();
  renderDaily();
  renderFriends();
  renderAudioToggles();
  renderPlayer();
  if (screen === 'shop') drawShop();
  renderLeaderboard();
  setSupportKind(support.kind);
  showSupportFile();
  if (!settingsEl.classList.contains('hidden')) {
    renderLangList();
    renderCbPicker();
    showSettingsTab(settingsTab);
  }
  menuBoardKey = null;
  drawMenuBoard();
});

// ---------------- colour-blind modes ----------------

function renderCbPicker() {
  const picker = $('cb-picker');
  const mode = colorBlindMode();
  picker.innerHTML = '';
  const options = [['off', 'Off', 'normal colours'], ...Object.entries(CB_MODES).map(([id, m]) => [id, m.label, m.note])].map(([id, l, n]) => [id, t(l), t(n)]);
  for (const [id, label, note] of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `cb-option${id === mode ? ' active' : ''}`;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(id === mode));
    const swatches = ['red', 'green', 'yellow', 'blue']
      .map((c) => {
        const hex = id === 'off' ? BOARD_THEMES['board-classic'].players[c] : CB_MODES[id].colors[c];
        const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        const dark = 0.299 * r + 0.587 * g + 0.114 * bl < 140; // white shape on dark colours
        return `<i class="${dark ? 'dark' : ''}" style="background:${hex}">${id === 'off' ? '' : SYMBOLS[c]}</i>`;
      })
      .join('');
    b.innerHTML = `<b>${label}</b><small>${note}</small><span class="cb-swatches">${swatches}</span>`;
    b.addEventListener('click', () => {
      setColorBlindMode(id);
      renderCbPicker();
      // Everything with player colours redraws: the board (next frame), panel, chat and shop
      chatVersion++;
      if (state) {
        renderUI();
        renderChat();
        if (screen === 'shop') drawShop();
      }
      drawMenuBoard();
    });
    picker.appendChild(b);
  }
}
// ---------------- profile card + avatars ----------------

// A round picture: the Discord avatar (through our server), or the first letter for guests.
function fillAvatar(el, person) {
  if (!el || !person) return;
  const key = `${person.id}|${person.avatar}`;
  if (el.dataset.for === key) return;
  el.dataset.for = key;
  el.textContent = (person.name || '?').trim().charAt(0).toUpperCase() || '?';
  el.style.background = `hsl(${[...String(person.id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0)} 45% 38%)`;
  if (!person.avatar) return;
  const img = new Image();
  img.alt = '';
  img.onload = () => {
    el.textContent = '';
    el.style.background = '';
    el.appendChild(img);
  };
  img.src = `${BASE}/api/avatar/${encodeURIComponent(person.id)}`;
}

function renderProfileCard() {
  if (!me) return;
  fillAvatar(document.querySelector('#profile-card [data-avatar]'), me);
  for (const av of document.querySelectorAll('[data-my-avatar], #profile-card [data-avatar]')) {
    fillAvatar(av, me);
    setFrame(av, profile?.equipped?.frame);
  }
  const level = playerLevel(profile);
  $('level-badge').textContent = t('Lv. {n}', { n: level });
  $('level-badge').title = t('Level {n}: one level for every badge medal you earn', { n: level });
  renderHubDots();
  $('profile-card').title = t('Signed in as {name}', { name: me.name });
  $('profile-sub').textContent = me.id.startsWith('guest-') ? t('Guest') : profile?.title && BADGES_BY_ID[profile.title] ? t(BADGES_BY_ID[profile.title].title) : t('Ludo player');
  renderDaily();
}

// ---------------- Today: the daily d20 and its 7-day streak ----------------

const STREAK_DAYS = 7;
const MINI_D20 = '<svg viewBox="0 0 100 100" aria-hidden="true"><polygon class="mini-out" points="50,6 90,28 90,72 50,94 10,72 10,28" /></svg>';

function renderStreak(day, rolledToday) {
  const strip = $('streak');
  strip.innerHTML = '';
  for (let d = 1; d <= STREAK_DAYS; d++) {
    const li = document.createElement('li');
    const done = d < day || (d === day && rolledToday);
    li.className = [done ? 'done' : '', d === day ? 'today' : '', d === STREAK_DAYS ? 'big' : ''].join(' ');
    li.innerHTML = `<span>${d}</span>${MINI_D20}${d === STREAK_DAYS ? '<span class="x2">×2</span>' : ''}${done ? '<span class="tick">✓</span>' : ''}`;
    li.title = d === STREAK_DAYS ? t('Day 7: double coins') : t('Day {n}', { n: d });
    strip.appendChild(li);
  }
}

const d20 = new D20($('d20-canvas'));
window.d20 = d20;

function renderDaily() {
  if (!profile || dailyAnim) return;
  els.todayCard.classList.remove('hidden');
  const ready = profile.dailyReady;
  const day = profile.streakDay || 1;
  const row = $('daily-row');
  row.classList.toggle('used', !ready);
  $('daily-roll').disabled = !ready;
  $('daily-btn').classList.toggle('hidden', !ready);
  if (ready) {
    $('daily-title').textContent = day === STREAK_DAYS ? t('Day 7: your roll pays double!') : t('Your d20 awaits');
    $('daily-info').textContent = t('Day {n} of 7 · 5 coins a pip, day 7 pays double', { n: day });
    if (d20.state !== 'ready') d20.set('ready', 20);
  } else {
    // If the die has landed and is celebrating its win, do not overwrite the win announcement
    if (d20.state === 'landed') return;
    const left = Math.max(0, profile.dailyNext - (Date.now() + clockOffset));
    $('daily-title').textContent = t('Rolled for today');
    $('daily-info').textContent = t('Day {n} of 7 · next roll in {time}', { n: day, time: timeLeft(left) });
    if (d20.state !== 'used') d20.set('used', 20);
  }
  renderStreak(day, !ready);
}
setInterval(() => screen === 'menu' && renderDaily(), 30_000);

function rollDaily() {
  if (!profile?.dailyReady || dailyAnim || ws?.readyState !== WebSocket.OPEN) return;
  $('daily-btn').classList.add('hidden');
  $('daily-roll').disabled = true;
  $('daily-title').textContent = t('Rolling…');
  sfx('roll');
  dailyAnim = true;
  d20.throw();
  ws.send(JSON.stringify({ type: 'daily' }));
}

// The server's roll arrives: the d20 tumbles onto it, then the prize is shown.
function onDailyRoll({ roll, coins, day, doubled }) {
  dailyAnim = true;
  d20.land(roll, () => {
    dailyAnim = null;
    $('daily-row').classList.add('used');
    const won = t('<b>+{coins} coins</b>', { coins });
    $('daily-title').innerHTML = roll === 20 ? `🎉 ${t('Natural 20!')} ${won}` : `${t('You rolled {n}:', { n: roll })} ${won}`;
    $('daily-info').textContent = doubled ? t('Day 7: doubled! A new streak starts tomorrow.') : t('Day {n} of 7 · come back tomorrow', { n: day });
    renderStreak(day || 1, true);
    sfx(roll >= 15 || doubled ? 'win' : 'step');

    // Deliver the profile reward coins and bump animation now that the die has landed!
    if (pendingDailyProfile) {
      const p = pendingDailyProfile;
      pendingDailyProfile = null;
      onProfile(p);
    }

    // the die shows its number in gold for a while, then greys out like any used chest
    setTimeout(() => {
      if (!dailyAnim) {
        d20.set('used', roll);
        renderDaily();
      }
    }, 7000);
  });
}
$('daily-roll').addEventListener('click', rollDaily);
$('daily-btn').addEventListener('click', rollDaily);

// ---------------- inbox ----------------
// The bell: friend requests waiting for an answer, "X accepted your request", and announcements
// from the game's owner. The red count is unread notices plus waiting requests.
let inboxData = { items: [], unread: 0, requests: [], canAnnounce: false };
let inboxFresh = new Set(); // unread when the inbox was opened: stays highlighted while it's open
const inboxEl = $('inbox');
function renderInbox() {
  const reqs = inboxData.requests || [];
  const n = (inboxData.unread || 0) + reqs.length;
  for (const b of document.querySelectorAll('[data-inbox-btn]')) {
    const badge = b.querySelector('.inbox-badge');
    badge.textContent = n > 9 ? '9+' : String(n);
    badge.classList.toggle('hidden', !n);
    b.setAttribute('aria-label', n ? t('Inbox: {n} new', { n }) : t('Inbox'));
  }
  $('inbox-compose').classList.toggle('hidden', !inboxData.canAnnounce);
  $('inbox-requests').classList.toggle('hidden', !reqs.length);
  const rl = $('inbox-request-list');
  rl.innerHTML = '';
  for (const r of reqs) {
    const li = document.createElement('li');
    li.className = 'inbox-item unread';
    const av = document.createElement('span');
    av.className = 'avatar';
    fillAvatar(av, r);
    const txt = document.createElement('div');
    txt.className = 'inbox-text';
    txt.innerHTML = '<b></b><small></small>';
    txt.querySelector('b').textContent = r.name;
    txt.querySelector('small').textContent = `${t('Wants to be friends')} · ${ago(r.at)}`;
    const acts = document.createElement('div');
    acts.className = 'inbox-acts';
    for (const [label, cls, op] of [[t('Accept'), 'primary', 'accept'], [t('Decline'), 'quiet', 'decline']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn small ${cls}`;
      b.textContent = label;
      b.addEventListener('click', () => ws?.send(JSON.stringify({ type: 'friend', op, id: r.id })));
      acts.appendChild(b);
    }
    li.append(av, txt, acts);
    rl.appendChild(li);
  }
  const list = $('inbox-list');
  list.innerHTML = '';
  for (const it of inboxData.items || []) {
    const li = document.createElement('li');
    li.className = `inbox-item${!it.read || inboxFresh.has(it.id) ? ' unread' : ''}`;
    const icon = document.createElement('span');
    icon.className = 'inbox-icon';
    icon.setAttribute('aria-hidden', 'true');
    const txt = document.createElement('div');
    txt.className = 'inbox-text';
    if (it.kind === 'news') {
      icon.textContent = '📣';
      txt.innerHTML = '<b></b><p></p><small></small>';
      txt.querySelector('b').textContent = it.title;
      txt.querySelector('p').textContent = it.body || '';
      if (!it.body) txt.querySelector('p').remove();
      txt.querySelector('small').textContent = `${t('Announcement')} · ${ago(it.at)}`;
    } else {
      icon.textContent = '🤝';
      txt.innerHTML = '<b></b><small></small>';
      txt.querySelector('b').textContent = t('{name} accepted your friend request', { name: it.name || t('Someone') });
      txt.querySelector('small').textContent = ago(it.at);
    }
    li.append(icon, txt);
    if (it.kind === 'news' && inboxData.canAnnounce) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn small quiet inbox-del';
      del.textContent = '✕';
      del.title = t('Take this announcement down');
      del.setAttribute('aria-label', del.title);
      del.addEventListener('click', () => {
        if (confirmRemove({ id: it.id, name: it.title })) ws?.send(JSON.stringify({ type: 'announce', op: 'delete', id: it.id }));
      });
      li.appendChild(del);
    }
    list.appendChild(li);
  }
  $('inbox-empty').classList.toggle('hidden', (inboxData.items || []).length > 0 || reqs.length > 0);
}
function openInbox() {
  closePlayer();
  closeSettings();
  inboxFresh = new Set((inboxData.items || []).filter((i) => !i.read).map((i) => i.id));
  inboxEl.classList.remove('hidden');
  renderInbox();
  $('inbox-close').focus();
  if (inboxData.unread) ws?.send(JSON.stringify({ type: 'inbox', op: 'read' }));
}
function closeInbox() {
  if (inboxEl.classList.contains('hidden')) return;
  inboxEl.classList.add('hidden');
  inboxFresh = new Set();
  renderInbox();
}
for (const b of document.querySelectorAll('[data-inbox-btn]')) b.addEventListener('click', openInbox);
$('inbox-close').addEventListener('click', closeInbox);
inboxEl.addEventListener('pointerdown', (e) => e.target === inboxEl && closeInbox());
$('inbox-compose').addEventListener('submit', (e) => {
  e.preventDefault();
  const title = $('announce-title').value.trim();
  if (!title) return;
  ws?.send(JSON.stringify({ type: 'announce', title, body: $('announce-body').value.trim() }));
  $('announce-title').value = '';
  $('announce-body').value = '';
});

// ---------------- friends ----------------

function ago(at) {
  const m = Math.floor((Date.now() - at) / 60_000);
  if (m < 60) return m <= 1 ? t('just now') : t('{m} min ago', { m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('{h}h ago', { h });
  const d = Math.floor(h / 24);
  return d === 1 ? t('yesterday') : t('{d} days ago', { d });
}

function renderFriends() {
  const list = $('friend-list');
  const hint = $('friends-hint');
  const data = friendsData || { friends: [], met: [] };
  for (const b of document.querySelectorAll('[data-ftab]')) b.classList.toggle('active', b.dataset.ftab === friendsTab);
  const online = data.friends.filter((f) => f.online).length;
  $('friends-count').textContent = data.friends.length ? `(${online ? t('{n} on', { n: online }) : data.friends.length})` : '';
  const requests = friendsTab === 'friends' ? data.requests || [] : [];
  const people = friendsTab === 'friends' ? [...requests.map((r) => ({ ...r, request: true })), ...[...data.friends].sort((a, b) => b.online - a.online)] : data.met;
  list.innerHTML = '';
  const inRoom = !!state?.code;
  for (const p of people) {
    const li = document.createElement('li');
    const av = document.createElement('span');
    av.className = `avatar${p.online ? ' online' : ''}`;
    fillAvatar(av, p);
    const who = document.createElement('div');
    who.className = 'friend-who';
    who.innerHTML = `<b></b><small class="${p.online ? 'on' : ''}"></small>`;
    who.querySelector('b').textContent = p.name;
    who.querySelector('small').textContent = p.request
      ? t('Wants to be friends')
      : p.online
        ? t('Online')
        : friendsTab === 'met' && p.at
          ? t('Played {when}', { when: ago(p.at) })
          : t('Offline');
    li.append(av, who);
    const btn = (label, cls, title, fn) => {
      const b = document.createElement('button');
      b.className = `btn small ${cls}`;
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', fn);
      li.appendChild(b);
      return b;
    };
    const friendOp = (op) => () => ws?.send(JSON.stringify({ type: 'friend', op, id: p.id }));
    if (p.request) {
      li.classList.add('is-request');
      btn(t('Accept'), 'primary', t('Become friends'), friendOp('accept'));
      btn(t('Decline'), 'quiet', t('Say no (they are not told)'), friendOp('decline'));
      list.appendChild(li);
      continue;
    }
    if (inRoom) btn(t('Invite'), 'primary', p.online ? t('Pops up in their game') : t('Sent to their Discord DMs'), () => ws?.send(JSON.stringify({ type: 'friendInvite', to: p.id })));
    if (friendsTab === 'met') {
      if (p.asked) btn(t('Accept'), 'primary', t('They sent you a friend request'), friendOp('accept'));
      else if (p.sent) btn(t('Requested'), 'quiet', t('Waiting for them to accept. Tap to take it back.'), friendOp('cancel'));
      else btn(t('+ Add'), '', t('Send a friend request'), friendOp('add'));
    } else {
      btn('💬', '', t('Message'), () => openDm(p.id, p.name));
      btn('✕', 'quiet', t('Remove friend'), () => {
        if (confirmRemove(p)) ws?.send(JSON.stringify({ type: 'friend', op: 'remove', id: p.id }));
      });
    }
    list.appendChild(li);
  }
  const reqCount = (data.requests || []).length;
  $('friends-req-dot').classList.toggle('hidden', !reqCount);
  if (friendsTab === 'friends' && !people.length)
    hint.textContent = data.met.length ? t('No friends yet: add people from Played with.') : t('Play a game with other people, then add them as friends here.');
  else if (friendsTab === 'met' && !people.length) hint.textContent = data.friends.length ? t('Everyone you played with is already a friend.') : t('People you play games with show up here.');
  else hint.textContent = inRoom ? '' : t('Make or join a room to invite people.');
  $('friends-discord').classList.toggle('hidden', !data.inviteUrl);
}
// A second tap within 3 s removes them (no browser dialogs inside Discord)
const removeArmed = new Map();
function confirmRemove(p) {
  if (Date.now() - (removeArmed.get(p.id) || 0) < 3000) {
    removeArmed.delete(p.id);
    return true;
  }
  removeArmed.set(p.id, Date.now());
  toast(t('Tap ✕ again to remove {name}', { name: p.name }), 'notice', 3000);
  return false;
}
for (const b of document.querySelectorAll('[data-ftab]')) {
  b.addEventListener('click', () => {
    friendsTab = b.dataset.ftab;
    renderFriends();
  });
}
// The Discord server invite, always on hand in the Friends card (the launch card only
// shows until you join or say no). Same link the invite card uses.
$('friends-discord').onclick = () => {
  const url = friendsData?.inviteUrl;
  if (!url) return;
  if (discordSdk) discordSdk.commands.openExternalLink({ url }).catch(() => {});
  else window.open(url, '_blank', 'noopener');
};
renderFriends();

// ---------- room invite-friends modal ----------
let roomFriendsTab = 'friends';
function renderRoomFriends() {
  const list = $('room-friend-list');
  const hint = $('room-friends-hint');
  const data = friendsData || { friends: [], met: [] };
  for (const b of document.querySelectorAll('[data-room-ftab]')) b.classList.toggle('active', b.dataset.roomFtab === roomFriendsTab);
  const online = data.friends.filter((f) => f.online).length;
  $('room-friends-count').textContent = data.friends.length ? `(${online ? t('{n} on', { n: online }) : data.friends.length})` : '';
  const people = roomFriendsTab === 'friends' ? [...data.friends].sort((a, b) => b.online - a.online) : data.met;
  list.innerHTML = '';
  for (const p of people) {
    const li = document.createElement('li');
    const av = document.createElement('span');
    av.className = `avatar${p.online ? ' online' : ''}`;
    fillAvatar(av, p);
    const who = document.createElement('div');
    who.className = 'friend-who';
    who.innerHTML = `<b></b><small class="${p.online ? 'on' : ''}"></small>`;
    who.querySelector('b').textContent = p.name;
    who.querySelector('small').textContent = p.online ? t('Online') : t('Offline');
    li.append(av, who);
    // Invite button
    const ib = document.createElement('button');
    ib.className = 'btn small primary';
    ib.textContent = t('Invite');
    ib.title = p.online ? t('Pops up in their game') : t('Sent to their Discord DMs');
    ib.addEventListener('click', () => {
      ws?.send(JSON.stringify({ type: 'friendInvite', to: p.id }));
      ib.textContent = t('Sent!');
      ib.disabled = true;
      setTimeout(() => { ib.textContent = t('Invite'); ib.disabled = false; }, 3000);
    });
    li.appendChild(ib);
    // Add friend button for "met" tab
    if (roomFriendsTab === 'met') {
      if (p.asked) {
        const ab = document.createElement('button');
        ab.className = 'btn small';
        ab.textContent = t('+ Add');
        ab.addEventListener('click', () => ws?.send(JSON.stringify({ type: 'friend', op: 'accept', id: p.id })));
        li.appendChild(ab);
      } else if (!p.sent) {
        const ab = document.createElement('button');
        ab.className = 'btn small';
        ab.textContent = t('+ Add');
        ab.addEventListener('click', () => ws?.send(JSON.stringify({ type: 'friend', op: 'add', id: p.id })));
        li.appendChild(ab);
      }
    }
    list.appendChild(li);
  }
  if (!people.length) hint.textContent = roomFriendsTab === 'friends'
    ? t('No friends yet — add people from Played with.')
    : t('People you play games with show up here.');
  else hint.textContent = '';
}
$('room-invite-friends-btn').addEventListener('click', () => {
  setDrawer(false);
  $('room-friends-modal').classList.remove('hidden');
  renderRoomFriends();
});
$('room-friends-close').addEventListener('click', () => $('room-friends-modal').classList.add('hidden'));
$('room-friends-modal').addEventListener('click', (e) => { if (e.target === $('room-friends-modal')) $('room-friends-modal').classList.add('hidden'); });
for (const b of document.querySelectorAll('[data-room-ftab]')) {
  b.addEventListener('click', () => { roomFriendsTab = b.dataset.roomFtab; renderRoomFriends(); });
}

// "Sam invited you to their room"
let roomInviteTimer = null;
function showRoomInvite({ from, fromId, code }) {
  const box = $('room-invite');
  fillAvatar(box.querySelector('[data-avatar]'), { id: fromId, name: from, avatar: !String(fromId).startsWith('guest-') });
  $('room-invite-text').innerHTML = t('{name} invited you to their room {code}', { name: `<b>${escapeHtml(from)}</b>`, code: `<b>${escapeHtml(code)}</b>` });
  box.classList.remove('hidden');
  sfx('turn');
  const close = () => box.classList.add('hidden');
  $('room-invite-join').onclick = () => {
    close();
    sendLobby('join', { code });
  };
  $('room-invite-no').onclick = close;
  clearTimeout(roomInviteTimer);
  roomInviteTimer = setTimeout(close, 30_000);
}

// ---------------- contact the developer ----------------
// A bug report or feedback, sent by the server to the owner's Discord DMs. Set questions for
// each kind, and an optional screenshot or short video: the answers go over the socket, then the
// file is uploaded with the one-time ticket that comes back. Bugs go straight away; feedback
// arrives in a daily digest.
const SUPPORT_MAX_FILE = 10 * 1024 * 1024;
const support = {
  wrap: $('support'),
  form: $('support-form'),
  note: $('support-note'),
  send: $('support-send'),
  file: $('support-file'),
  fileLabel: $('support-file-label'),
  kinds: [...document.querySelectorAll('#support [data-kind]')],
  status: $('support-status'),
  done: $('support-done'),
  doneText: $('support-done-text'),
  kind: 'bug',
  picked: {}, // chip and star answers: { often: 'once', where: 'game', topic: 'idea', stars: 4 }
  pendingFile: null,
  waitTimer: null,
};
// Messages show inside the form (a toast would sit behind it)
function supportStatus(text, kind = 'err') {
  support.status.textContent = text;
  support.status.className = `support-status ${kind}`;
}
const SUPPORT_NOTES = {
  bug: 'Bug reports go to the developer straight away. A screenshot or clip helps a lot!',
  feedback: 'Ideas, wishes, anything. Feedback is read in a daily batch.',
};
function setSupportKind(kind) {
  support.kind = kind;
  for (const b of support.kinds) {
    b.classList.toggle('active', b.dataset.kind === kind);
    b.setAttribute('aria-checked', String(b.dataset.kind === kind));
  }
  for (const f of support.form.querySelectorAll('.support-fields')) f.classList.toggle('on', f.dataset.for === kind);
  support.note.textContent = t(SUPPORT_NOTES[kind]);
}
// Chips (one choice) and stars: tap to pick, tap the same star again to clear
for (const group of support.form.querySelectorAll('.chips, .stars')) {
  const q = group.dataset.q;
  for (const b of group.querySelectorAll('button')) {
    b.addEventListener('click', () => {
      const v = q === 'stars' ? Number(b.dataset.v) : b.dataset.v;
      support.picked[q] = support.picked[q] === v && q === 'stars' ? null : v;
      for (const o of group.querySelectorAll('button')) {
        const ov = q === 'stars' ? Number(o.dataset.v) : o.dataset.v;
        o.classList.toggle('on', q === 'stars' ? support.picked[q] && ov <= support.picked[q] : ov === support.picked[q]);
      }
    });
  }
}
function showSupportFile() {
  const f = support.file.files[0];
  const label = support.file.closest('.attach');
  if (f && f.size > SUPPORT_MAX_FILE) {
    toast(t('That file is too big (10 MB at most): try a shorter clip or a screenshot'));
    support.file.value = '';
  }
  const ok = support.file.files[0];
  label.classList.toggle('has', !!ok);
  support.fileLabel.textContent = ok ? `📎 ${ok.name} (${(ok.size / 1048576).toFixed(1)} MB) · ${t('tap to change')}` : t('📎 Add a picture or video');
}
support.file.addEventListener('change', showSupportFile);
function resetSupport() {
  support.form.reset();
  support.picked = {};
  for (const b of support.form.querySelectorAll('.chips button, .stars button')) b.classList.remove('on');
  showSupportFile();
}
function openSupport() {
  closePlayer();
  closeSettings();
  setSupportKind(support.kind);
  supportStatus('', '');
  support.form.classList.remove('hidden');
  support.done.classList.add('hidden');
  support.wrap.classList.remove('hidden');
}
function closeSupport() {
  support.wrap.classList.add('hidden');
}
$('support-done-close').addEventListener('click', closeSupport);
$('support-open').addEventListener('click', openSupport);
$('support-close').addEventListener('click', closeSupport);
support.wrap.addEventListener('pointerdown', (e) => e.target === support.wrap && closeSupport());
for (const b of support.kinds) b.addEventListener('click', () => setSupportKind(b.dataset.kind));
support.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const box = support.form.querySelector(`.support-fields[data-for="${support.kind}"]`);
  const answers = {};
  for (const el of box.querySelectorAll('textarea[data-q], input[data-q]')) answers[el.dataset.q] = el.value.trim();
  for (const g of box.querySelectorAll('.chips, .stars')) answers[g.dataset.q] = support.picked[g.dataset.q] ?? null;
  // the same checks as the server, so mistakes show at once
  const missing =
    support.kind === 'bug'
      ? (answers.what.length < 10 && 'Tell us what happened (at least 10 characters)') ||
        (answers.before.length < 3 && 'Tell us what you were doing just before') ||
        (!answers.often && 'How often does it happen?') ||
        (!answers.where && 'Where did it happen?')
      : (!answers.topic && 'What is your feedback about?') || (answers.text.length < 10 && 'Tell us a bit more (at least 10 characters)');
  if (missing) return supportStatus(t(missing));
  if (ws?.readyState !== WebSocket.OPEN) return supportStatus(t('Not connected right now, try again in a moment'));
  const file = support.file.files[0] || null;
  support.pendingFile = file;
  support.send.disabled = true;
  support.send.textContent = t('Sending…');
  supportStatus(t('Sending…'), 'busy');
  // No answer at all (connection dropped, or an older server): say so instead of hanging
  clearTimeout(support.waitTimer);
  support.waitTimer = setTimeout(() => {
    support.send.disabled = false;
    support.send.textContent = t('Send');
    supportStatus(t("No answer from the server, so it wasn't sent. Check your connection and try again."));
  }, 15000);
  ws.send(JSON.stringify({ type: 'support', kind: support.kind, answers, attach: file ? { size: file.size } : null, device: navigator.userAgent, version: document.querySelector('script[type=module][src]')?.getAttribute('src') || '' }));
});
async function onSupportReply(msg) {
  clearTimeout(support.waitTimer);
  support.send.disabled = false;
  support.send.textContent = t('Send');
  if (msg.type === 'supportError') return supportStatus(translateServer(msg.message));
  const file = support.pendingFile;
  support.pendingFile = null;
  let fileNote = '';
  if (msg.ticket && file) {
    support.send.disabled = true;
    support.send.textContent = t('Uploading…');
    supportStatus(file.type.startsWith('video') ? t('Uploading the video…') : t('Uploading the picture…'), 'busy');
    try {
      const r = await fetch(`${BASE}/api/support/upload?ticket=${encodeURIComponent(msg.ticket)}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!r.ok) {
        const why = await r.json().catch(() => ({}));
        fileNote = ` ${t("(Your file couldn't be attached: {why}.)", { why: translateServer(why.error) || t('the upload failed') })}`;
      }
    } catch {
      fileNote = ` ${t("(Your file couldn't be uploaded.)")}`;
    }
    support.send.disabled = false;
    support.send.textContent = t('Send');
  }
  // The server has it: say so clearly
  support.doneText.textContent =
    (msg.when === 'now'
      ? t('Bug report #{id} is on its way to the developer. Thank you!', { id: msg.id })
      : t('Your feedback (#{id}) is in. The developer reads feedback every day. Thank you!', { id: msg.id })) + fileNote;
  resetSupport();
  supportStatus('', '');
  support.form.classList.add('hidden');
  support.done.classList.remove('hidden');
}

// ---------------- smooth mode ----------------
// Fewer board effects (drifting water, floating particles, glows) for phones whose graphics can't
// keep up. Turns itself on when the dice and pins visibly stutter, unless you turned it off.
const SMOOTH_KEY = 'ludo-smooth'; // 'on' | 'off' | missing (decide automatically)
let smoothPref = null;
try {
  smoothPref = localStorage.getItem(SMOOTH_KEY);
} catch {
  // no storage: decide automatically
}
// ⚙ Settings → Graphics: Full effects / Smooth
const gfxButtons = [...document.querySelectorAll('[data-gfx]')];
function renderSmoothToggles() {
  for (const b of gfxButtons) {
    const on = (b.dataset.gfx === 'smooth') === (smoothPref === 'on');
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  }
  renderer.setLite(smoothPref === 'on');
}
function setSmooth(on) {
  smoothPref = on ? 'on' : 'off';
  try {
    localStorage.setItem(SMOOTH_KEY, smoothPref);
  } catch {
    // only for this visit
  }
  renderSmoothToggles();
}
for (const b of gfxButtons) b.addEventListener('click', () => setSmooth(b.dataset.gfx === 'smooth'));
renderSmoothToggles();

// Watching for stutter: the time between frames while something moves (they should come every
// ~17ms). Judged over a couple of seconds of movement, so one slow moment doesn't count.
const moveFrames = [];
function watchSmoothness(gap) {
  if (smoothPref || document.hidden || gap > 250) return; // decided already / tab in the background
  moveFrames.push(gap);
  if (moveFrames.length < 150) return;
  const avg = moveFrames.reduce((a, b) => a + b, 0) / moveFrames.length;
  moveFrames.length = 0;
  if (avg > 26) {
    setSmooth(true);
    toast(t('Graphics set to Low: fewer board effects so this device keeps up. Change it in ⚙ Settings.'), 'ok', 6000);
  }
}

// Browsers only allow sound after the player interacts with the page.
for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, unlockAudio, { capture: true });

function mySeat() {
  if (!state || !me) return -1;
  return state.seats.findIndex((s) => s && !s.bot && s.userId === me.id);
}

// The colour whose tokens you move: your own seat's, or in a team decider your team's colour.
function playSeat() {
  const seat = mySeat();
  if (seat < 0 || !state?.decider) return seat;
  const t = state.decider.players.findIndex((ps) => ps.includes(seat));
  return t >= 0 ? state.decider.colors[t] : -1;
}

// Is it your go? (In a decider your team's colour takes turns: only when it's yours to roll.)
function myGo() {
  const seat = playSeat();
  return state?.phase === 'playing' && seat >= 0 && state.turn === seat && (state.actor == null || state.actor === mySeat());
}

// Whoever plays this turn (in a decider: the teammate rolling for the colour)
function turnPlayer() {
  return state.seats[state.actor ?? state.turn];
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

// Play now with nobody else about: when the new room was made, and how long until bots are offered
let loneSince = 0;
const LONE_MS = Number(new URLSearchParams(location.search).get("loneMs")) || 20_000; // (?loneMs= for testing)

function isHost() {
  return state && me && state.hostId === me.id;
}

// ---------------- screens ----------------

function showScreen(name) {
  if (name !== 'game' && finishTimer) {
    clearTimeout(finishTimer);
    finishTimer = null;
  }
  if (name !== 'shop') {
    closeItemView();
    if (screen === 'shop') commitShopSeen(); // what you looked at isn't new next time
  }
  screen = name;
  if (name === 'menu') requestAnimationFrame(() => d20.start());
  // The menu's chat is only listened to while it's on screen
  const chatShown = name === 'menu' && $('menu').dataset.panel === 'chat';
  if (chatShown || lchat.open) lobbyChatPanel(chatShown);
  for (const [id, el] of Object.entries(els.screens)) el.classList.toggle('hidden', id !== name);
  if (name === 'shop') {
    drawShop();
    if (discordSdk) preloadPrices(coinStoreContext()); // for "≈ £…" under gem prices
  }
  if (name === 'profile') drawProfile();
  renderNewDots();
  if (name === 'menu') fetchLeaderboard();
  renderUI();
}


// Not enough coins (or gems) for something? Says so (gems: offers the gem store) and returns true.
function short(currency, price) {
  if (freeShop) return false;
  const have = profile?.[currency] ?? 0;
  if (have >= price) return false;
  if (currency === 'gems') openGemStore(price - have); // (the store says how many, and which pack covers it)
  else toast(t('You need {n} more coins', { n: price - have }));
  return true;
}

function shopContext() {
  return {
    profile,
    freeShop,
    onBuy: (item) => {
      if (short(currencyOf(item), priceOf(item))) return;
      sendShop('buy', item.id);
      sfx('buy');
      toast(t('Bought {item}!', { item: t(item.name) }), 'ok');
    },
    onBuySet: (set) => {
      const { price, currency } = setPrice(set, profile);
      if (short(currency, price)) return;
      sendShop('buySet', set.id);
      sfx('buy');
      toast(t('Bought {item}!', { item: t(set.name) }), 'ok');
    },
    onEquip: (item) => {
      sendShop('equip', item.id);
      sfx('equip');
    },
    onGetGems: (need = 0) => openGemStore(need),
    avatar: me?.avatar || null,
    canClaim: (item) => !!passClaimTarget(item),
    onClaim: (item) => {
      const target = passClaimTarget(item);
      if (!target || ws?.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'pass', op: 'claim', lane: target.lane, tier: target.tier }));
    },
    onOpenPass: () => {
      closeItemView();
      showScreen('menu');
      setPanel('pass');
    },
  };
}

function passClaimTarget(item) {
  const p = profile?.pass;
  if (!p || !item) return null;
  const { tiers } = passRewards(p.month);
  for (const x of tiers) {
    if (x.tier > p.tier) break;
    for (const lane of ['free', 'premium']) {
      if (lane === 'premium' && !p.active) continue;
      if (x[lane]?.item === item.id && !p[lane].includes(x.tier)) return { lane, tier: x.tier };
    }
  }
  return null;
}

function drawShop() {
  const ctx = shopContext();
  const now = Date.now() + clockOffset;
  renderShop(
    { tabs: els.shopTabs, grid: els.shopGrid },
    {
      ...ctx,
      day: dayKeyOf(now),
      now,
      gemsInMoney,
      // the Starter Pack card: only when it can actually be bought here
      starterOnSale: !!(paidConfig.skus.some((x) => x.id === STARTER.id) || paidConfig.webPrices?.[STARTER.id]),
      starterPrice: paidPrice(STARTER.id),
      tab: shopTab,
      onTab: (tab) => {
        shopTab = tab;
        drawShop();
      },
      onView: (item) => openItemView(item, shopContext()),
    },
  );
  refreshItemView(ctx);
}

function renderUI() {
  const narrow = matchMedia('(max-width: 480px)').matches;
  for (const el of els.coins) el.querySelector('b').textContent = profile ? coinText(profile.coins, el.classList.contains('menu-coins') || (narrow && !!el.closest('.head-wallet'))) : '…';
  for (const el of els.gems) el.querySelector('b').textContent = profile ? coinText(profile.gems ?? 0, el.classList.contains('menu-gems')) : '…';
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
  renderProfileCard();
  renderReferral();
  if (!!state?.code !== friendsInRoom) {
    friendsInRoom = !!state?.code; // the Invite buttons come and go with your room
    renderFriends();
  }
  els.myRoom.classList.toggle('hidden', !state);
  els.createCard.classList.toggle('hidden', !!state); // one room at a time: leave yours to make another
  $('play-card').classList.toggle('hidden', !!state);
  renderDeal();

  for (const b of els.visibilityPicker.querySelectorAll('[data-visibility]')) {
    b.classList.toggle('active', b.dataset.visibility === newVisibility);
  }
  els.visibilityHint.textContent =
    newVisibility === 'public'
      ? t('Anyone can find it in the room list and join.')
      : t('Only people in your Discord call see it. Others join with its code.');

  // The room list: every open room. All In rooms are tagged (they're also in the All In sheet).
  const others = roomList.filter((r) => r.id !== state?.roomId);
  els.roomsCount.textContent = t('{n} open', { n: others.length });
  els.roomList.innerHTML = '';
  if (!others.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    if (state) li.textContent = t('No other rooms right now.');
    else {
      li.append(`${t('No open rooms right now.')} `);
      const start = document.createElement('button');
      start.type = 'button';
      start.className = 'link-btn';
      start.textContent = t('Start one');
      start.addEventListener('click', () => sendLobby('create', { visibility: 'public' }));
      li.appendChild(start);
    }
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
    nameText.textContent = translateServer(r.name);
    name.appendChild(nameText);
    const meta = document.createElement('div');
    meta.className = 'room-meta';
    const status = r.phase === 'lobby' ? (r.players < r.seats ? t('Waiting') : t('Full')) : r.phase === 'playing' ? t('Playing') : t('Game over');
    meta.textContent = `${t(r.label)} · ${status}`;
    if (r.stake) {
      // a stakes room: what it costs to sit in
      const st = document.createElement('span');
      st.className = 'room-stake';
      st.innerHTML = `<span class="coin"></span>${r.stake.toLocaleString(currentLang())}`;
      st.title = t('Stake {n} coins', { n: r.stake });
      name.appendChild(st);
      li.classList.add('stakes');
      if (r.winnerTakeAll) {
        const tag = document.createElement('span');
        tag.className = 'room-allin';
        tag.textContent = t('All In');
        tag.title = t('Winner takes all · 1.5× points');
        name.appendChild(tag);
        li.classList.add('allin');
      }
    }
    if (r.sameCall) {
      const call = document.createElement('span');
      call.className = 'room-call';
      call.textContent = ` · ${t('in your call')}`;
      meta.appendChild(call);
    }
    info.append(name, meta);

    const seats = document.createElement('span');
    seats.className = 'room-seats';
    seats.title = t('{n} of {total} seats taken', { n: r.players, total: r.seats });
    seats.setAttribute('aria-label', seats.title);
    for (let i = 0; i < r.seats; i++) {
      const dot = document.createElement('i');
      if (i < r.players) dot.className = 'on';
      seats.appendChild(dot);
    }

    const canSit = r.phase === 'lobby' && r.players < r.seats;
    const join = button(canSit ? t('Join') : t('Watch'), () => sendLobby('join', { id: r.id }));
    join.classList.add(canSit ? 'join' : 'watch');
    li.append(info, seats, join);
    els.roomList.appendChild(li);
  }
  drawMenuBoard();
}

const LOCK_ICON =
  '<svg class="ico" viewBox="0 0 16 16" aria-label="Private"><rect x="3.25" y="7" width="9.5" height="7" rx="1.5" /><path d="M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7" /></svg>';

// ---------------- menu: the board beside the actions (wide screens) ----------------
// The player's own board, with their tokens and dice, playing a slow game by itself: every few
// seconds one colour rolls and moves. It only paints while something moves (a second or two in
// every five), not while the menu is hidden, and holds still for people who turn motion off.
// Tap it for the Shop.
const menuBoard = new BoardRenderer($('menu-board'));
const menuBoardCaption = $('menu-board-caption');
const MENU_BOARD = boardFor('4p');
const MENU_BOARD_MAX = 620; // widescreen PCs get a bigger board
const MENU_TURN_MS = 5200; // one move every this often
const MENU_HOP_MS = 260; // one square
const MENU_FLY_MS = 700; // a token that has gone round flies back to base
const MENU_LAST = 46; // a token past here goes back to base (the slow game never ends)
const stillMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
let menuBoardKey = '';
let menuGame = { pos: [6, 6, 6, 6], turn: 0, move: null, next: 0 };
let menuRaf = 0;
let menuWait = 0; // between moves: a timer, not a frame loop

const menuLook = () => ({
  board: myTheme() || 'board-classic',
  token: profile?.equipped?.token || 'token-classic',
  dice: profile?.equipped?.dice || 'dice-classic',
});

function drawMenuBoard() {
  if (screen !== 'menu') return stopMenuGame();
  const hero = menuBoard.canvas.parentElement;
  const width = hero.clientWidth; // 0 when the hero is hidden (narrow screens)
  if (!width) return stopMenuGame();
  const size = Math.min(MENU_BOARD_MAX, width);
  const look = menuLook();
  const key = [size, window.devicePixelRatio || 1, look.board, look.token, look.dice, colorBlindMode(), currentLang()].join('|');
  if (key !== menuBoardKey) {
    menuBoardKey = key;
    menuBoard.setBoard(MENU_BOARD, look.board);
    menuBoard.resize(size);
    captionMenuBoard(look);
    paintMenuBoard(performance.now());
  }
  if (!menuRaf && !menuWait && !stillMotion?.matches) {
    menuGame.next = Math.max(menuGame.next, performance.now() + 1500); // a moment's pause before the first move
    menuRaf = requestAnimationFrame(menuFrame);
  }
}

function stopMenuGame() {
  cancelAnimationFrame(menuRaf);
  clearTimeout(menuWait);
  menuRaf = menuWait = 0;
}

// "Classic board · Rocket tokens · Gold dice", and how to change them
function captionMenuBoard(look) {
  const name = (id) => escapeHtml(t(ITEMS[id]?.name || ''));
  menuBoardCaption.innerHTML = `<span>${t('{board} board · {token} tokens · {dice} dice', {
    board: `<b>${name(look.board)}</b>`,
    token: `<b>${name(look.token)}</b>`,
    dice: `<b>${name(look.dice)}</b>`,
  })}</span><span class="hero-change">${t('Change in the Shop')} →</span>`;
}

// One frame of the slow game. Between moves nothing changes, so nothing is painted.
function menuFrame(now) {
  menuRaf = 0;
  if (screen !== 'menu' || document.hidden || !menuBoard.canvas.parentElement.clientWidth) return;
  const g = menuGame;
  if (!g.move && now < g.next) {
    menuWait = setTimeout(() => {
      menuWait = 0;
      menuRaf = requestAnimationFrame(menuFrame);
    }, g.next - now);
    return;
  }
  if (!g.move) {
    // the next colour rolls: out of base on a 6, home to base once it has gone far enough
    const seat = g.turn;
    const from = g.pos[seat];
    const value = from < 0 ? 6 : 1 + Math.floor(Math.random() * 6);
    const fly = from >= 0 && from + value > MENU_LAST;
    const path = from < 0 ? [-1, 0] : fly ? [from, -1] : Array.from({ length: value + 1 }, (_, i) => from + i);
    g.move = { seat, value, path, fly, t0: now };
  }
  if (g.move) {
    // 30 frames a second is plenty for a game nobody is playing
    if (now - (g.painted || 0) < 30) {
      menuRaf = requestAnimationFrame(menuFrame);
      return;
    }
    g.painted = now;
    paintMenuBoard(now);
    const m = g.move;
    const walk = m.fly ? MENU_FLY_MS : (m.path.length - 1) * MENU_HOP_MS;
    if (now - m.t0 > 1300 + walk + LEAVE_MS + 120) {
      g.pos[m.seat] = m.path[m.path.length - 1];
      g.turn = (g.turn + 1) % 4;
      g.move = null;
      g.next = now + MENU_TURN_MS - 1300 - walk;
      paintMenuBoard(now);
    }
  }
  menuRaf = requestAnimationFrame(menuFrame);
}

function paintMenuBoard(now) {
  const look = menuLook();
  const g = menuGame;
  const seats = MENU_BOARD.colors.map((_, i) => i);
  const tokens = seats.map((i) => [g.pos[i], -1, -1, -1]);
  const overrides = new Map();
  let dice = null;
  const m = g.move;
  if (m) {
    const d = now - m.t0;
    const color = playerColor(look.board, MENU_BOARD.colors[m.seat]);
    const base = { value: m.value, style: look.dice, color, sign: MENU_BOARD.colors[m.seat], axes: [2.7, 1.6] };
    const walk = m.fly ? MENU_FLY_MS : (m.path.length - 1) * MENU_HOP_MS;
    if (d < 900) dice = { ...base, mode: 'spin', t: d };
    else if (d < 1300 + walk) dice = { ...base, mode: 'shown', t: d - 900 };
    else dice = { ...base, mode: 'leave', t: d - 1300 - walk };
    const at = (p) => MENU_BOARD.tokenCenter(m.seat, p, 0);
    const w = d - 1300;
    if (w >= 0 && w < walk) {
      const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
      const hop = (a, b, k, high) => ({ x: a.x + (b.x - a.x) * ease(k), y: a.y + (b.y - a.y) * ease(k), lift: Math.sin(Math.PI * k) * high, squash: 1 });
      if (m.fly) overrides.set(`${m.seat}-0`, hop(at(m.path[0]), at(-1), w / MENU_FLY_MS, 2.5));
      else {
        const i = Math.min(m.path.length - 2, Math.floor(w / MENU_HOP_MS));
        overrides.set(`${m.seat}-0`, hop(at(m.path[i]), at(m.path[i + 1]), (w % MENU_HOP_MS) / MENU_HOP_MS, m.path[i] < 0 ? 1.2 : 0.5));
      }
    } else if (w >= walk) tokens[m.seat][0] = m.path[m.path.length - 1];
  }
  menuBoard.draw(
    { tokens, active: seats, skins: seats.map(() => look.token), overrides: overrides.size ? overrides : null, highlight: null, turn: m ? m.seat : null, dice, emotes: [] },
    now,
  );
}

// The board (and its caption) are the way into the Shop
const heroEl = $('menu-hero');
heroEl.addEventListener('click', () => showScreen('shop'));
heroEl.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), showScreen('shop')));
document.addEventListener('visibilitychange', () => !document.hidden && drawMenuBoard());

// A board texture finished loading: draw the board again
window.addEventListener('ludo-textures', () => {
  menuBoardKey = null;
  drawMenuBoard();
});

let menuResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(menuResizeTimer);
  menuResizeTimer = setTimeout(drawMenuBoard, 120);
});

// ---------------- menu: today's deal ----------------
// One item a day at 30% off (the same for everyone). Hidden once you own it. Tap: its close-up.
let dealKey = '';
function renderDeal() {
  const card = $('deal-card');
  const day = dayKeyOf(Date.now() + clockOffset);
  const deal = dailyDeal(day);
  const owned = !profile || ownsItem(profile, deal.id);
  card.classList.toggle('hidden', owned);
  if (owned) return;
  const theme = myTheme() || 'board-classic';
  const key = [deal.id, theme, currentLang()].join('|');
  if (key !== dealKey) {
    dealKey = key;
    $('deal-art').replaceChildren(itemPreview(deal, theme));
    $('deal-name').textContent = t(deal.name);
    $('deal-off').textContent = `−${Math.round(DEAL_DISCOUNT * 100)}%`;
    card.dataset.rarity = rarityOf(deal).id;
    card.setAttribute('aria-label', `${t("Today's deal")}: ${t(deal.name)}`);
  }
  const TYPE = { token: 'Token', dice: 'Dice', board: 'Board', taunt: 'Taunt' };
  const ends = new Date(`${day}T00:00:00Z`).getTime() + 86_400_000;
  $('deal-meta').textContent = `${t(rarityOf(deal).label)} · ${t(TYPE[deal.type])} · ${t('ends in {time}', { time: timeLeft(ends - (Date.now() + clockOffset)) })}`;
  $('deal-price').innerHTML = `<s>${coinText(deal.price)}</s><span><span class="coin"></span>${coinText(priceOf(deal, day))}</span>`;
}
function openDeal() {
  const deal = dailyDeal(dayKeyOf(Date.now() + clockOffset));
  shopTab = deal.type;
  showScreen('shop');
  openItemView(deal, shopContext());
}
$('deal-card').addEventListener('click', openDeal);
$('deal-card').addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openDeal()));
setInterval(() => screen === 'menu' && renderDeal(), 60_000);

// The card for the room you're in, at the top of the menu.
function renderMyRoom() {
  const board = boardFor(state.mode);
  els.gameTitle.textContent = translateServer(state.roomName);
  els.gameMode.textContent = t(MODES[state.mode].label);
  // Menu version of the room info: the lock icon instead of emoji, to match the room list
  const kind = state.visibility === 'private' ? `${LOCK_ICON} ${t('Private')}` : t('Public');
  els.myRoomInfo.innerHTML = `${kind} · ${t('code {code}', { code: escapeHtml(state.code) })}`;

  // Everyone who has joined, with their colour
  els.gamePlayers.innerHTML = '';
  const joined = state.seatsAllowed.filter((i) => state.seats[i]);
  for (const i of joined) {
    const s = state.seats[i];
    const tag = s.userId === state.hostId ? t('Host') : s.bot ? t('Bot') : s.surrendered ? t('Out') : me && s.userId === me.id ? t('You') : '';
    els.gamePlayers.appendChild(listItem(playerColor(myTheme(), board.colors[i]), sym(board.colors[i]) + s.name, tag));
  }
  const open = state.seatsAllowed.length - joined.length;
  if (state.phase === 'lobby' && open > 0) {
    els.gamePlayers.appendChild(listItem(null, open === 1 ? t('1 open seat') : t('{n} open seats', { n: open }), '', true));
  }

  els.playBtn.textContent = state.phase === 'playing' ? (mySeat() >= 0 ? t('Back to game') : t('Watch game')) : t('Back to room');
  // A finished game can be reset by anyone; a running one only by the host.
  els.newGameBtn.classList.toggle('hidden', !(state.phase === 'finished' || (state.phase === 'playing' && isHost())));
}

// "🔒 Private · code K7QX" — the code is what friends type to join.
function roomInfoText() {
  const kind = state.visibility === 'private' ? `🔒 ${t('Private')}` : `🌐 ${t('Public')}`;
  const stake = state.pot ? ` · ${t('Pot {n} coins', { n: state.pot.total.toLocaleString(currentLang()) })}` : state.stake ? ` · ${t('Stake {n} coins', { n: state.stake.toLocaleString(currentLang()) })}` : '';
  return `${kind} · ${t('code {code}', { code: state.code })}${stake}`;
}

// Cash pot (Classic: Off or 100..10,000, shared by all except last) vs Stakes Room (100..10,000, winner takes all)
function renderStakes() {
  const box = $('stake-picker');
  const host = isHost();
  const wta = !!state.winnerTakeAll;
  box.classList.toggle('hidden', state.phase !== 'lobby');
  box.classList.toggle('on', !!state.stake);
  const titleEl = box.querySelector('.stake-text b');
  const subEl = box.querySelector('.stake-text small');
  if (titleEl) titleEl.textContent = wta ? t('All In') : t('Cash pot');
  if (subEl) subEl.textContent = `${wta ? t('Only 1st place wins the pot') : t('Everyone pays in; pot shared by all except last')} · ${t('{n}% house fee', { n: Math.round(POT_FEE * 100) })}`;
  const opts = $('stake-options');
  const key = `${state.stake}|${wta}|${host}|${currentLang()}`;
  if (opts.dataset.key === key) return;
  opts.dataset.key = key;
  opts.innerHTML = '';
  const all = state.stakes || STAKES;
  const stakes = wta ? all.filter((n) => n > 0) : all;
  const idx = Math.max(0, stakes.indexOf(state.stake || 0));
  const amount = stakes[idx] || 0;
  const pill = document.createElement('span');
  pill.className = `stake-val${amount ? ' on' : ''}`;
  pill.innerHTML = amount ? `<span class="coin"></span>${amount.toLocaleString(currentLang())}` : escapeHtml(t('Off'));
  if (!host) {
    opts.appendChild(pill);
    return;
  }
  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'stake-step';
  prev.textContent = '‹';
  prev.disabled = idx <= 0;
  prev.addEventListener('click', () => idx > 0 && send('setStake', { stake: stakes[idx - 1] }));
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'stake-step';
  next.textContent = '›';
  next.disabled = idx >= stakes.length - 1;
  next.addEventListener('click', () => idx < stakes.length - 1 && send('setStake', { stake: stakes[idx + 1] }));
  opts.append(prev, pill, next);
}

// ☰ → room settings: only the host can change them.
function renderRoomSettings() {
  els.roomSettings.classList.toggle('hidden', !isHost());
  const pub = state.visibility === 'public';
  els.visibilityBtn.textContent = pub ? `🌐 ${t('Public')}` : `🔒 ${t('Private')}`;
  els.visibilityNote.textContent = pub ? t('(listed for everyone)') : t('(your call or the code)');
}

// ☰ → everyone in the room. Mute is just for you; Kick (host only) removes them for good.
let kickArmed = null; // a Kick needs a second tap within 3 s
let kickTimer = null;
function renderPeople() {
  els.peopleList.innerHTML = '';
  const seated = new Map(state.seats.filter((s) => s && !s.bot).map((s) => [s.userId, s]));
  // Players who left mid-game are listed too (they can be kicked once they're properly gone)
  const here = new Set(state.people.map((p) => p.id));
  const gone = [...seated.values()].filter((s) => !here.has(s.userId) && !s.surrendered).map((s) => ({ id: s.userId, name: s.name, gone: true }));
  const now = Date.now() + clockOffset;
  let recheck = Infinity; // when a "just disconnected" player becomes kickable
  for (const p of [...state.people, ...gone]) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'name';
    const roles = [p.id === state.hostId && t('host'), p.id === me?.id && t('you'), !seated.has(p.id) && t('watching'), p.gone && t('disconnected')].filter(Boolean);
    name.textContent = p.name + (roles.length ? ` (${roles.join(', ')})` : '');
    if (muted.has(p.id)) name.classList.add('is-muted');
    li.appendChild(name);
    if (p.id !== me?.id) {
      li.appendChild(button(muted.has(p.id) ? t('Unmute') : t('Mute'), () => toggleMute(p.id)));
      // Kick: anyone in the lobby; during a game only players who have left (after their grace)
      const seat = seated.get(p.id);
      const kickableAt = state.phase === 'lobby' ? 0 : p.gone ? (seat?.disconnectedAt ?? 0) + (state.disconnectGrace || 0) : Infinity;
      if (kickableAt > now && kickableAt < Infinity) recheck = Math.min(recheck, kickableAt);
      if (isHost() && kickableAt <= now) {
        const armed = kickArmed === p.id;
        const kick = button(armed ? t('Sure?') : t('Kick'), () => {
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
  clearTimeout(renderPeople.timer);
  if (recheck < Infinity) renderPeople.timer = setTimeout(() => state && renderPeople(), recheck - now + 100);
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

const BOT_LEVEL_LABELS = { easy: 'Easy', medium: 'Medium', hard: 'Hard', impossible: 'Impossible' };

function renderPanel() {
  const seat = mySeat();
  const { phase } = state;
  const board = boardFor(state.mode);
  // Team games show the score: points from finishing places (3/2/1/0 in 2 vs 2)
  const pts = state.teamPoints;
  const score = pts && phase !== 'lobby' ? ` · A ${pts[0]} – ${pts[1]} B` : '';
  els.phaseTag.textContent =
    phase === 'lobby'
      ? `${t('Lobby')} · ${t(MODES[state.mode].label)}`
      : (phase === 'playing' ? (state.decider ? t('Decider') : t('In game')) : t('Game over')) + score;
  els.roomInfo.textContent = roomInfoText();
  renderStakes();
  renderRoomSettings();
  renderPeople();

  // Mode picker (host only, lobby only)
  els.modePicker.classList.toggle('hidden', phase !== 'lobby');
  // Quick game, under it: the host flips it, everyone else sees what was picked
  els.quickBtn.classList.toggle('hidden', phase !== 'lobby');
  els.quickBtn.setAttribute('aria-checked', String(!!state.quick));
  els.quickBtn.disabled = !isHost();
  const modeKey = `${state.mode}|${isHost()}|${currentLang()}`;
  if (els.modePicker.dataset.key !== modeKey) {
    els.modePicker.dataset.key = modeKey;
    els.modePicker.innerHTML = '';
    for (const [id, m] of Object.entries(MODES)) {
      const b = button(t(m.label), () => send('setMode', { mode: id }));
      b.classList.toggle('active', id === state.mode);
      b.classList.toggle('team', !!m.teams);
      if (m.teams) b.title = t('Team game: teammates sit opposite each other');
      b.disabled = !isHost();
      els.modePicker.appendChild(b);
    }
  }

  // Seats. Left alone while a bot's difficulty list is open: rebuilding the seats (any room update
  // does) threw the open list away, so on phones it closed by itself after a second.
  const picking = document.activeElement?.matches?.('.bot-level') && els.seats.contains(document.activeElement);
  if (!picking) {
    els.seats.innerHTML = '';
    els.seats.classList.toggle('six', state.seatsAllowed.length > 4);
    for (const i of seatOrder(board, state.seatsAllowed)) {
      const s = state.seats[i];
      const colorName = board.colors[i];
      const card = document.createElement('div');
      card.className = 'seat';
      card.style.setProperty('--seat-color', col(colorName));
      if (phase === 'playing' && (state.actor ?? state.turn) === i) card.classList.add('turn');
      if (s && !s.bot && me && s.userId === me.id) card.classList.add('me');
      if (s && !s.connected) card.classList.add('offline');

      const top = document.createElement('div');
      top.className = 'seat-top';
      top.innerHTML = `<span class="seat-dot"></span><span class="seat-name"></span>`;
      top.querySelector('.seat-name').textContent = s ? s.name : capitalize(colorName);
      top.querySelector('.seat-name').dataset.you = ` (${t('you')})`;
      if (s && !s.bot) {
        // their picture, in their profile frame (VIP) if they wear one
        const av = document.createElement('span');
        av.className = 'avatar seat-avatar';
        fillAvatar(av, { id: s.userId, name: s.name, avatar: !String(s.userId).startsWith('guest-') });
        setFrame(av, s.skins?.frame);
        top.insertBefore(av, top.querySelector('.seat-name'));
      }
      if (s && !s.bot && state.stake && s.canPay === false && phase === 'lobby') {
        const warn = document.createElement('small');
        warn.className = 'seat-broke';
        warn.textContent = t('Not enough coins for the stake');
        card.classList.add('broke');
        top.after(warn);
      }
      const team = teamOfSeat(i);
      if (team >= 0) {
        // Team games: which side this seat is on (teammates sit opposite each other)
        const tag = document.createElement('span');
        tag.className = `seat-team t${team}`;
        tag.textContent = 'AB'[team];
        tag.title = `${t('Team {letter}', { letter: 'AB'[team] })}: ${teamLabel(board, team)}`;
        top.appendChild(tag);
        card.classList.add(`team-${team}`);
      }
      if (isColorBlind()) {
        // The seat's shape in place of the plain dot
        const dot = top.querySelector('.seat-dot');
        dot.classList.add('sym');
        dot.textContent = SYMBOLS[colorName];
      }
      card.appendChild(top);
      // their pinned badges and title
      const look = lookHtml(s?.look);
      if (look) {
        const line = document.createElement('div');
        line.className = 'seat-look';
        line.innerHTML = look;
        card.appendChild(line);
      }

      const sub = document.createElement('div');
      sub.className = 'seat-sub';
      if (!s) sub.textContent = t('Empty seat');
      else if (phase === 'lobby' && s.bot) {
        // The bot's difficulty: the host picks it here, everyone else just sees it
        const level = s.level || 'medium';
        if (isHost()) {
          const pick = document.createElement('select');
          pick.className = `bot-level lvl-${level}`;
          pick.setAttribute('aria-label', t("{name}'s difficulty", { name: s.name }));
          for (const [id, label] of Object.entries(BOT_LEVEL_LABELS)) pick.add(new Option(`🤖 ${t(label)}`, id, false, id === level));
          pick.addEventListener('change', () => send('botLevel', { seat: i, level: pick.value }));
        pick.addEventListener('blur', () => setTimeout(renderUI)); // catch up on what changed meanwhile
          sub.appendChild(pick);
        } else sub.textContent = `🤖 ${t(BOT_LEVEL_LABELS[level])}`;
      } else if (phase === 'lobby') sub.textContent = s.userId === state.hostId ? t('Host') : t('Ready');
      else if (s.surrendered) sub.textContent = `🏳️ ${t('Surrendered')}`;
      else if (phase === 'playing' && state.decider) {
        const tm = state.decider.players.findIndex((ps) => ps.includes(i));
        sub.textContent = tm >= 0 ? `🎲 ${t('Rolls for {color}', { color: capitalize(board.colors[state.decider.colors[tm]]) })}` : t('Out of the decider');
      } else {
        const home = state.tokens[i].filter((p) => p >= board.finished).length;
        const place = state.winners.indexOf(i);
        const missed = state.timeouts?.[i] || 0;
        // Just dropped out: the server waits a few seconds for them before playing for them
        const away = s.disconnectedAt && state.serverNow - s.disconnectedAt < state.disconnectGrace ? ` · ${t('reconnecting…')}` : ` · ${t('offline (auto)')}`;
        const teamPlace = state.teamOrder ? state.teamOrder.indexOf(team) : -1;
        sub.textContent =
          teamPlace === 0
            ? `🏆 ${t('Winning team')}`
            : teamPlace > 0
              ? t('{place} team', { place: ordinal(teamPlace + 1) })
              : team >= 0 && place >= 0
                ? `🏠 ${t('{place} · +{points} for the team', { place: ordinal(place + 1), points: state.pointsFor?.[place] ?? 0 })}`
                : place >= 0
                  ? `🏆 ${t('{place} place', { place: ordinal(place + 1) })}`
                  : `${t('{n}/4 home', { n: home })}${s.bot ? ` · ${t(BOT_LEVEL_LABELS[s.level || 'medium'])}` : s.connected ? '' : away}${missed ? ` · ⏰ ${missed}/${state.maxTimeouts}` : ''}`;
      }
      card.appendChild(sub);

      if (phase === 'lobby' && state.hostId) {
        const actions = document.createElement('div');
        actions.className = 'seat-actions';
        if (!s) {
          actions.appendChild(button(seat >= 0 ? t('Switch') : t('Sit'), () => send('sit', { seat: i })));
          if (isHost()) actions.appendChild(button(t('+ Bot'), () => send('addBot', { seat: i })));
        } else if (seat === i) {
          actions.appendChild(button(t('Leave'), () => send('stand')));
        } else if (isHost()) {
          actions.appendChild(button(s.bot ? t('Remove') : t('Kick'), () => send('removeSeat', { seat: i })));
        }
        card.appendChild(actions);
      }
      els.seats.appendChild(card);
    }
  }

  // Controls
  els.lobbyControls.classList.toggle('hidden', phase !== 'lobby');
  // Alone in the room Play now made: after a little while, offer to start against bots
  const humans = state.seats.filter((x) => x && !x.bot).length;
  if (phase !== 'lobby' || humans > 1) loneSince = 0;
  $('lone-card').classList.toggle('hidden', !(loneSince && isHost() && Date.now() - loneSince >= LONE_MS));
  els.playControls.classList.toggle('hidden', phase !== 'playing');
  if (phase === 'playing' && mySeat() >= 0) maybeTour(); // (the first game only)
  els.finishControls.classList.toggle('hidden', phase !== 'finished');

  if (phase === 'lobby') {
    const count = state.seats.filter(Boolean).length;
    const empty = state.seatsAllowed.some((i) => !state.seats[i]);
    els.startBtn.classList.toggle('hidden', !isHost());
    els.fillBtn.classList.toggle('hidden', !isHost() || !empty);
    els.startBtn.disabled = count < 2;
    const hostName = state.seats.find((s) => s && s.userId === state.hostId)?.name;
    if (!state.hostId) {
      els.lobbyHint.textContent = t('Nobody is hosting yet. Go back to the menu to host a game.');
    } else if (isHost()) {
      els.lobbyHint.textContent =
        count < 2 ? t('Pick a seat, then wait for friends or add a bot.') : t('{n} players ready.', { n: count });
    } else {
      els.lobbyHint.textContent = seat < 0 ? t('Pick a seat to join.') : hostName ? t('Waiting for {name} to start…', { name: hostName }) : t('Waiting for the host to start…');
    }
  }

  if (phase === 'playing') {
    const cur = { ...turnPlayer() };
    if (state.decider) cur.name = `${cur.name} (${capitalize(board.colors[state.turn])})`;
    const myTurn = myGo();
    const rolls = state.rolls || [];
    const sixes = !state.rolled && rolls.length; // a throw with a 6 kept, waiting for the next throw
    const two = (state.diceCount || 1) > 1;
    const last = (state.diceValues?.length ? state.diceValues : [state.dice]).join(' + ');
    const extra = state.extraTurns ? ` (${state.extraTurns > 1 ? t('+{n} extra turns', { n: state.extraTurns }) : t('+1 extra turn')})` : '';
    const choices = new Set();
    (state.options || []).forEach((o, i) => o.forEach((tk) => choices.add(`${rolls[i]}:${state.tokens[state.turn]?.[tk]}`)));
    let text;
    const name = cur.name;
    if (state.skipped)
      text = myTurn
        ? two ? t('A 6 three times in a row — your turn is skipped!') : t('Three 6s — your turn is skipped!')
        : two ? t('{name} rolled a 6 three times in a row — turn skipped', { name }) : t('{name} rolled three 6s — turn skipped', { name });
    else if (myTurn && sixes && two) text = t('You have {rolls} — a 6, roll again!', { rolls: rolls.join(' + ') });
    else if (myTurn && sixes) text = rolls.length > 1 ? t('You rolled {n} sixes — roll again!', { n: rolls.length }) : t('You rolled a 6 — roll again!');
    else if (myTurn && !state.rolled) text = two ? t('Your turn — tap the dice to roll both!') : t('Your turn — tap the dice!');
    else if (myTurn && choices.size === 1) text = t('You rolled {rolls} — moving your token…', { rolls: rolls.join(' + ') }); // the server moves it
    else if (myTurn && state.movable.length && rolls.length > 1) text = t('You have {rolls} — tap a glowing token, then pick a dice', { rolls: rolls.join(' + ') });
    else if (myTurn && state.movable.length) text = t('You rolled a {n} — tap a glowing token', { n: rolls[0] });
    else if (myTurn) text = t('You rolled {rolls} — no moves this time', { rolls: two ? last : state.dice });
    else if (sixes) text = t('{name} rolled a 6 — rolling again', { name });
    else if (state.rolled) text = t('{name} rolled {rolls}', { name, rolls: rolls.length ? rolls.join(' + ') : two ? last : state.dice });
    else text = t("{name}'s turn", { name });
    if (state.paused) {
      text = t('Paused — every player left. The game ends in {s}s if nobody comes back', { s: Math.round(state.pauseMs / 1000) });
      els.turnText.textContent = `⏸️ ${text}`;
    } else {
      const team = teamOfColor(state.turn);
      const mate = state.decider && state.turn === playSeat() && !myTurn;
      const side = mate ? ` · ${t("your teammate's go")}` : team >= 0 && !myTurn && seat >= 0 ? ` · ${teamOfSeat(seat) === team ? t('your team') : t('other team')}` : '';
      els.turnText.textContent = sym(board.colors[state.turn]) + text + side + extra;
    }
    els.turnText.dir = 'auto';
    els.turnText.style.color = col(board.colors[state.turn]);
  }
  const racing =
    phase === 'playing' &&
    seat >= 0 &&
    !state.seats[seat].surrendered &&
    (state.decider ? state.decider.players.flat().includes(seat) : !state.winners.includes(seat));
  els.surrenderBtn.classList.toggle('hidden', !racing);
  updateTurnNudge();
  els.screens.game.dataset.phase = phase; // the phone layout hides the seat cards while playing
  els.screens.game.dataset.arms = String(board.arms);

  if (phase !== 'finished') {
    if (finishTimer) {
      clearTimeout(finishTimer);
      finishTimer = null;
    }
    els.banner.classList.add('hidden');
  }

  // Emotes live in chat now: the emoji button on the chat form opens the picker.
  renderEmojiPops();
}

// Team games: the team a seat plays for (0, 1…), or -1 when everyone plays for themselves.
function teamOfSeat(seat) {
  return state?.teams ? state.teams.findIndex((t) => t.includes(seat)) : -1;
}

// The team whose tokens a colour is. Same as teamOfSeat, except in the decider: there the
// colour belongs to the team racing it (in 2v2 the second team races a teammate pair's colour).
function teamOfColor(color) {
  if (!state?.decider) return teamOfSeat(color);
  return state.decider.colors.indexOf(color);
}

// "Red & Yellow"
function teamLabel(board, team) {
  return state.teams[team].map((s) => capitalize(board.colors[s])).join(' & ');
}

function rewardNote(s) {
  const coins = state.rewards?.[s];
  const capped = state.rewardCapped?.includes(s);
  const partial = state.rewardPartial?.includes(s);
  const note = [capped ? t('daily limit reached') : '', partial ? t('ended early') : ''].filter(Boolean).join(', ');
  return (coins || capped ? ` <span class="reward">+${coins || 0} 🪙${note ? ` (${note})` : ''}</span>` : '') + potNote(s);
}

// Stakes games: what this seat won from the pot
function potNote(s) {
  const won = state.potWon?.[s];
  return won ? ` <span class="reward pot">💰 ${escapeHtml(t('+{n} from the pot', { n: won.toLocaleString(currentLang()) }))}</span>` : '';
}

// One player's numbers for the game, under their name on the finish card: tokens captured,
// sixes rolled, tokens brought home. Whoever captured the most gets a little crown for it.
function finishStats(seat) {
  const all = state.tally || {};
  const mine = all[seat] || {};
  const most = Math.max(0, ...Object.values(all).map((x) => x.capture || 0));
  const chip = (icon, n, label) => `<span class="stat-chip" title="${escapeHtml(t(label))}">${icon} ${n || 0}</span>`;
  const mvp = most > 0 && (mine.capture || 0) === most ? `<span class="stat-chip mvp">👑 ${escapeHtml(t('Most captures'))}</span>` : '';
  return `<div class="finish-stats">${chip('⚔️', mine.capture, 'Captures')}${chip('🎲', mine.six, 'Sixes')}${chip('🏠', mine.home, 'Tokens home')}${mvp}</div>`;
}

// ---- your game, on the finish card: badge progress it moved, badge levels and quests it completed ----
let gameLog = null; // { stats at the start, quests completed, badge levels reached } for this game
const refreshFinish = () => !els.banner.classList.contains('hidden') && showFinish();
function myGameSummary() {
  if (!gameLog || mySeat() < 0 || !profile) return '';
  const rows = BADGES.filter((b) => b.stat)
    .map((b) => ({ b, before: gameLog.stats[b.stat] || 0, now: profile.stats?.[b.stat] || 0 }))
    .filter((r) => r.now > r.before)
    .sort((a, c) => c.now - c.before - (a.now - a.before))
    .slice(0, 3)
    .map(({ b, before, now }) => {
      const lvl = levelFor(b, now);
      const from = lvl ? b.goals[lvl - 1] : 0;
      const goal = b.goals[Math.min(lvl, 2)];
      const pct = (v) => (lvl >= 3 ? 100 : Math.max(0, Math.min(100, ((v - from) / (goal - from)) * 100)));
      const was = before < from ? 0 : pct(before);
      const is = pct(now);
      return `<div class="gs-row">${medalHtml(b, lvl, 'tiny')}<span class="gs-name">${escapeHtml(t(b.name))}</span><span class="gs-bar"><i class="was" style="width:${was}%"></i><i class="gain" style="left:${was}%;width:${Math.max(0, is - was)}%"></i></span><span class="gs-num">${lvl >= 3 ? '✓' : `${Math.min(now, goal)}/${goal}`}</span></div>`;
    });
  const chips = [
    ...gameLog.badges.map((r) => `<span class="gs-chip">${BADGES_BY_ID[r.badge]?.icon || '🏅'} ${escapeHtml(t(BADGES_BY_ID[r.badge]?.name || ''))} · ${escapeHtml(t(['Bronze', 'Silver', 'Gold'][r.level - 1]))} <b>+${r.coins}</b></span>`),
    ...gameLog.quests.map((q) => `<span class="gs-chip">${q.bonus ? '🎉' : '✅'} ${escapeHtml(t(q.title))} <b>+${q.coins}</b></span>`),
  ];
  if (!rows.length && !chips.length) return '';
  return `<div class="game-summary"><div class="gs-head">${escapeHtml(t('Your game'))}</div>${rows.join('')}${chips.length ? `<div class="gs-chips">${chips.join('')}</div>` : ''}</div>`;
}

function showFinish() {
  if (state.teamOrder) return showTeamFinish();
  const lines = state.winners.map((s, i) => {
    const coins = state.rewards?.[s];
    const capped = state.rewardCapped?.includes(s);
    const partial = state.rewardPartial?.includes(s);
    const note = [capped ? t('daily limit reached') : '', partial ? t('ended early') : ''].filter(Boolean).join(', ');
    const reward = (coins || capped ? ` <span class="reward">+${coins || 0} 🪙${note ? ` (${note})` : ''}</span>` : '') + potNote(s);
    const title = state.seats[s]?.look?.title && BADGES_BY_ID[state.seats[s].look.title] ? ` <span class="seat-title">${escapeHtml(t(BADGES_BY_ID[state.seats[s].look.title].title))}</span>` : '';
    return `${MEDALS[i] || `${i + 1}.`} ${escapeHtml(state.seats[s]?.name)}${title}${reward}${finishStats(s)}`;
  });
  const why = {
    bots: t('No coins for games against bots only — play with friends to earn.'),
    abandoned: t('Everyone left and nobody came back, so no coins this time.'),
    test: `🧪 ${t('Test game (rigged dice): no coins or points.')}`,
  }[state.noCoins];
  const title = state.noCoins === 'abandoned' ? t('Game ended') : t('Game over!');
  const note = why ? `<div class="banner-note">${why}</div>` : '';
  els.banner.innerHTML = `<div class="banner-title">${title}</div>${lines.join('')}${note}${myGameSummary()}`;
  els.banner.classList.remove('hidden');
}

// Team games: one line per team, winners first, with each player's coins
function showTeamFinish() {
  const board = boardFor(state.mode);
  const lines = state.teamOrder.map((tm, i) => {
    const players = state.teams[tm]
      .filter((s) => state.seats[s])
      .map((s) => `${escapeHtml(state.seats[s].name)}${rewardNote(s)}`)
      .join(', ');
    const pts = state.teamPoints ? ` · ${state.teamPoints[tm]} ${t('pts')}` : '';
    return `${MEDALS[i] || `${i + 1}.`} <b>${teamLabel(board, tm)}</b>${pts}: ${players}`;
  });
  // a tie on points that went to the decider round
  if (state.decider && state.noCoins !== 'abandoned') lines.unshift(`<div class="banner-note">🤝 ${t('A draw on points, won in the decider')}</div>`);
  const why = {
    bots: t('No coins for games against bots only — play with friends to earn.'),
    abandoned: t('Everyone left and nobody came back, so no coins this time.'),
    test: `🧪 ${t('Test game (rigged dice): no coins or points.')}`,
  }[state.noCoins];
  const mine = teamOfSeat(mySeat());
  const title = state.noCoins === 'abandoned' ? t('Game ended') : mine < 0 ? t('Game over!') : mine === state.teamOrder[0] ? `${t('Your team wins!')} 🎉` : t('Game over!');
  const coop = !why && state.noPoints === 'coop' ? t('Teamed up against bots: coins, but no leaderboard points. Play against each other to climb the board.') : '';
  const note = why || coop ? `<div class="banner-note">${why || coop}</div>` : '';
  els.banner.innerHTML = `<div class="banner-title">${title}</div>${lines.join('<br>')}${note}${myGameSummary()}`;
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
  if (current?.predicted && now - current.sentAt > 3000) {
    // No answer to a move: put the pin back where the server has it
    current = null;
    shownTokens = latestTokens;
  }
  if (dice.mode === 'spin' && dice.waiting) {
    if (pendingRoll && !pendingRoll.retried && now - dice.t0 > 1400 && state?.phase === 'playing' && myGo() && !state.rolled && ws?.readyState === WebSocket.OPEN) {
      // One safe idempotent retry if the roll answer is slow through the proxy
      pendingRoll.retried = true;
      send('roll', { seq: pendingRoll.seq });
    } else if (now - dice.t0 > 3500) {
      rollPending = null;
      pendingRoll = null;
      if (state?.phase === 'playing' && myGo() && !state.rolled) {
        dice = { mode: 'ready', seat: state.turn, t0: now };
        toast(t('Connection hiccup — tap the dice to roll again'), 'notice', 3000);
      } else {
        dice = { mode: 'hidden' };
      }
    }
  }
  // Failsafe: a non-waiting spin whose animation already cleared must never keep spinning endlessly
  if (dice.mode === 'spin' && !dice.waiting && (!current || current.type !== 'roll') && now - dice.t0 > 1500) {
    dice = state?.phase === 'playing' && state.rolled ? { mode: 'shown', seat: state.turn, value: state.dice, values: state.diceValues, t0: now } : { mode: 'hidden' };
  }
  if (current) {
    current.elapsed += dt * (events.length >= 2 ? 2 : 1); // hurry when falling behind
    if (current.predicted) current.elapsed = Math.min(current.elapsed, current.moveMs - 1); // land once confirmed
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
    renderer.confetti(state.winners.slice(0, 3).map((s) => col(boardFor(state.mode).colors[s])).concat('#ffffff', '#f6cf57'));
    // the winner's own token takes a bow, in its own style
    if (state.winners.length) renderer.celebrate(state.winners[0], state.seats[state.winners[0]]?.skins?.token);
    sfx('win');
    if (state.winners.length) sfx('bow');

    if (finishTimer) {
      clearTimeout(finishTimer);
      finishTimer = null;
    }

    // Let the winning token celebration play out visibly before showing the finish leaderboard
    if (state.winners.length && state.noCoins !== 'abandoned') {
      finishTimer = setTimeout(() => {
        finishTimer = null;
        if (state.phase === 'finished') showFinish();
      }, 4000);
    } else {
      showFinish();
    }
  }
}

function startEvent(ev, now) {
  current = ev;
  ev.elapsed = 0;
  if (ev.type === 'roll') {
    rollPending = null;
    pendingRoll = null;
    ev.duration = SPIN_MS;
    if (dice.mode === 'spin' && dice.waiting && dice.seat === ev.seat) {
      // Already tumbling since the tap: keep the same turn and speed, now heading for the real value.
      // (While waiting the angle kept going at the roll's starting speed; pick the axes that match
      // that angle in whole turns, so the hand-over doesn't jump.)
      const w = (now - dice.t0) / SPIN_MS;
      const axes = dice.axes.map((a) => a * (1 - 3 * w) + Math.round(3 * w * a));
      dice = { mode: 'spin', seat: ev.seat, value: ev.value, values: ev.values, t0: now, axes, bank: ev.bank };
      return;
    }
    // A different tumble each roll: 2–3 turns one way, 1–2 the other.
    const axes = [(2 + Math.random()) * (Math.random() < 0.5 ? -1 : 1), 1 + Math.random()];
    dice = { mode: 'spin', seat: ev.seat, value: ev.value, values: ev.values, t0: now, axes, bank: ev.bank };
    sfx('roll');
    return;
  }
  const { move } = ev;
  ev.steps = [];
  if (move.from < 0) ev.steps.push(0);
  else for (let p = move.from + 1; p <= move.to; p++) ev.steps.push(p);
  ev.hopMs = move.from < 0 ? EXIT_MS : STEP_MS;
  ev.moveMs = ev.steps.length * ev.hopMs;
  ev.duration = ev.moveMs + (move.captured.length ? captureMs(move.captured, move.seat) : 120);
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
  dice = state.phase === 'playing' && state.rolled ? { mode: 'shown', seat: state.turn, value: state.dice, values: state.diceValues, t0: 0 } : { mode: 'hidden' };
}

// A token's own way home (TOKEN_SIGNATURES), if the captured seat is using one that has one
const signatureOf = (seat) => TOKEN_SIGNATURES[state.seats[seat]?.skins?.token] || null;
// How long the captured tokens take to get home: the slowest of them
const captureMs = (captured, capturerSeat = null) => {
  const capturerTime = capturerSeat !== null ? signatureOf(capturerSeat)?.captureMs || 0 : 0;
  return Math.max(CAPTURE_MS, capturerTime, ...captured.map((c) => signatureOf(c.seat)?.ms || 0));
};

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
      // a Legendary token leaves a little of itself behind at every hop
      const trail = signatureOf(seat);
      if (trail?.legend && i > 0) renderer.burst(a.x, a.y, trail.colors, { count: 5, speed: 1.4, life: 480, size: 0.09 });
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
      // (a Legendary token makes a bigger splash of it, in its own colours)
      const sig = signatureOf(seat)?.legend ? signatureOf(seat) : null;
      renderer.burst(end.x, end.y, sig ? sig.colors : [color, '#ffffff', '#ffd23f'], { count: sig ? 40 : 22, speed: sig ? 6.5 : 5, life: sig ? 900 : 700 });
      if (sig) renderer.ring(end.x, end.y, sig.colors[0], 1.6);
      // Revenge, and capture streaks: called out big for everyone in the room
      const who = state.seats[seat]?.name || '';
      let announcerMs = 0;
      if (ev.move.revenge) {
        renderer.callout(t('Revenge!'), color, 0);
        sfx('revenge');
        announcerMs += 1350;
        // (only games against other people pay coins)
        if (seat === mySeat() && state.seats.filter((x) => x && !x.bot).length >= 2) toast(`⚔️ ${t('Revenge! +{n} coins when the game ends', { n: REWARDS.revenge })}`, 'ok');
      }
      const streak = ev.move.streak || 0;
      if (streak >= 2) {
        const word = streak === 2 ? t('Double!') : streak === 3 ? t('Rampage!') : t('Unstoppable!');
        renderer.callout(word, color, ev.move.revenge ? 1 : 0, who);
        sfx(streak >= 4 ? 'unstoppable' : streak === 3 ? 'rampage' : 'double');
        announcerMs += (streak >= 4 ? 1750 : streak === 3 ? 1550 : 1350);
      }
      // the capturer's taunt, if they wear one (and this player hasn't turned taunts off)
      // When an announcer line plays (Revenge / Double), stagger the taunt until the announcer
      // voice finishes so they don't talk simultaneously and both audio and visuals land together!
      const taunt = state.seats[seat]?.skins?.taunt;
      if (prefs.taunts && TAUNT_FX[taunt]) {
        const v = captured[0].seat;
        const triggerTaunt = () => {
          renderer.taunt(end.x, end.y, taunt, color, { seat: v, color: col(board.colors[v]), name: state.seats[v]?.name || '' });
          sfx(taunt);
        };
        if (announcerMs > 0) {
          setTimeout(triggerTaunt, announcerMs);
        } else {
          triggerTaunt();
        }
      }
      if (state.seats[seat]?.skins?.token === 'token-ufo') sfx('ufo-capture');
      else sfx('capture');
    }
    if (ev.move.finishedToken) {
      renderer.burst(end.x, end.y, [color, '#f6cf57', '#ffffff'], { count: 30, speed: 4, life: 900 });
      sfx('home');
    }
  }
  const isUfoCapturer = captured.length > 0 && state.seats[seat]?.skins?.token === 'token-ufo';
  if (isUfoCapturer) {
    const c = captured[0];
    const cTo = board.tokenCenter(c.seat, -1, c.token);
    const ufoDur = 1750;
    const ufoK = Math.min(1, (e - ev.moveMs) / ufoDur);
    ev.sigDone ||= new Set();
    const once = (tag) => !ev.sigDone.has(`${seat}-${token}-${tag}`) && !!ev.sigDone.add(`${seat}-${token}-${tag}`);

    if (ufoK < 0.22) {
      // Phase 1: UFO hovers directly over the square, tractor beam engages and lifts victim
      const liftUfo = Math.min(2.2, (ufoK / 0.15) * 2.2);
      map.set(`${seat}-${token}`, { x: end.x, y: end.y, lift: liftUfo, squash: 1 });
      const liftC = (ufoK / 0.22) * 0.9;
      map.set(`${c.seat}-${c.token}`, { x: end.x, y: end.y, lift: liftC, squash: 1 + 0.08 * Math.sin(ufoK * 40), scale: 0.88 });
      if (once('ufo-start')) renderer.burst(end.x, end.y, ['#aaffe6', '#5cf2ff', '#ffffff'], { count: 12, speed: 2 });
    } else if (ufoK < 0.72) {
      // Phase 2: UFO flies across the board to the victim's base, carrying the beamed token under it
      const flight = easeInOut((ufoK - 0.22) / 0.50);
      const midX = end.x + (cTo.x - end.x) * flight;
      const midY = end.y + (cTo.y - end.y) * flight;
      map.set(`${seat}-${token}`, { x: midX, y: midY, lift: 2.2 + 0.14 * Math.sin(flight * Math.PI), squash: 1 });
      map.set(`${c.seat}-${c.token}`, { x: midX, y: midY, lift: 0.9, squash: 1 + 0.05 * Math.sin(ufoK * 30), scale: 0.88 });
      if (Math.random() < 0.3) renderer.burst(midX, midY, ['#aaffe6', '#5cf2ff'], { count: 1, speed: 1.0, life: 300 });
    } else if (ufoK < 0.85) {
      // Phase 3: Hovering over base, lowering victim into base slot
      const drop = (ufoK - 0.72) / 0.13;
      map.set(`${seat}-${token}`, { x: cTo.x, y: cTo.y, lift: 2.2, squash: 1 });
      map.set(`${c.seat}-${c.token}`, { x: cTo.x, y: cTo.y, lift: (1 - drop) * 0.9, squash: drop > 0.8 ? 0.85 : 1, scale: 0.88 + 0.12 * drop });
      if (ufoK > 0.82 && once('ufo-drop')) {
        renderer.burst(cTo.x, cTo.y, ['#aaffe6', '#5cf2ff', '#ffffff'], { count: 16, speed: 3.5 });
        renderer.ring(cTo.x, cTo.y, '#5cf2ff', 0.9);
      }
    } else {
      // Phase 4: UFO zips back to its landing square
      const ret = easeInOut((ufoK - 0.85) / 0.15);
      map.set(`${seat}-${token}`, { x: cTo.x + (end.x - cTo.x) * ret, y: cTo.y + (end.y - cTo.y) * ret, lift: (1 - ret) * 2.2, squash: ret > 0.9 ? 0.9 : 1 });
      map.set(`${c.seat}-${c.token}`, { x: cTo.x, y: cTo.y, lift: 0, squash: 1, scale: 1 });
    }

    // Any remaining captured tokens:
    for (let ci = 1; ci < captured.length; ci++) {
      const extraC = captured[ci];
      const from = board.tokenCenter(extraC.seat, ev.start[extraC.seat][extraC.token], extraC.token);
      const to = board.tokenCenter(extraC.seat, -1, extraC.token);
      const ct = Math.min(1, (e - ev.moveMs) / CAPTURE_MS);
      const k = easeInOut(ct);
      map.set(`${extraC.seat}-${extraC.token}`, { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, lift: Math.sin(Math.PI * ct) * 2.5, squash: 1 });
    }
    return map;
  }

  const settle = Math.min(1, (e - ev.moveMs) / 160);
  map.set(`${seat}-${token}`, { x: end.x, y: end.y, lift: 0, squash: 0.8 + 0.2 * easeOutBack(settle) });

  // Captured tokens fly back to base.
  for (const c of captured) {
    const from = board.tokenCenter(c.seat, ev.start[c.seat][c.token], c.token);
    const to = board.tokenCenter(c.seat, -1, c.token);
    const sig = signatureOf(c.seat);
    const ct = Math.min(1, (e - ev.moveMs) / (sig?.ms || CAPTURE_MS));
    if (sig) {
      ev.sigDone ||= new Set();
      const once = (tag) => !ev.sigDone.has(`${c.seat}-${c.token}-${tag}`) && !!ev.sigDone.add(`${c.seat}-${c.token}-${tag}`);
      map.set(`${c.seat}-${c.token}`, signatureHome(sig, ct, from, to, once, renderer, sfx));
      continue;
    }
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
    if (dice.mode === 'spin' && dice.waiting) {
      rollPending = null;
      pendingRoll = null;
    }
    if (dice.mode !== 'hidden' && dice.mode !== 'leave') leave();
    return;
  }
  if (dice.mode === 'spin' && dice.waiting && (dice.seat !== state.turn || state.rolled)) {
    // Turn already moved on or rolled on the server while we waited: stop spinning immediately
    rollPending = null;
    pendingRoll = null;
    dice = state.rolled ? { mode: 'shown', seat: state.turn, value: state.dice, values: state.diceValues, t0: now } : { mode: 'hidden' };
  }
  if (state.rolled) {
    // Back after a move with rolls still to play, or joined mid-turn: show the roll to use
    if (dice.mode === 'hidden' || dice.mode === 'ready') dice = { mode: 'shown', seat: state.turn, value: state.dice, values: state.diceValues, t0: now };
    return;
  }
  // A 6 that was kept stays readable for a moment before the dice comes back for the next roll
  if (dice.mode === 'shown' && state.rolls?.length && now - dice.t0 < SIX_HOLD_MS) return;
  // Let everyone see a non-moving roll briefly before shrinking the dice for the next turn
  if (dice.mode === 'shown' && dice.seat !== state.turn && now - dice.t0 < Math.max(HOLD_MS, 500)) return;
  if (dice.mode === 'shown' || (dice.mode === 'ready' && dice.seat !== state.turn)) leave();
  else if (dice.mode === 'hidden') {
    dice = { mode: 'ready', seat: state.turn, t0: now };
    if (myGo() && !state.rolls?.length) showTurnPop(); // not again after each 6
  }
}

// A roll we've sent but the server hasn't answered yet: until the next roll shows up
// (or 2s pass), more taps are ignored, so a double-tap can't roll twice.
let rollPending = null; // { seq, at }

function sendRoll() {
  if (ws?.readyState !== WebSocket.OPEN) {
    toast(t('Reconnecting…'), 'notice', 2000);
    return;
  }
  const now = performance.now();
  rollPending = { seq: state.lastRoll?.seq ?? null, at: now };
  pendingRoll = { seq: state.seq ?? null, seat: dice.seat, t0: now, retried: false };
  send('roll', { seq: pendingRoll.seq });
  // Start tumbling right away instead of waiting for the server's answer (in Discord that goes
  // through their proxy, and a dice that sat still for that moment felt laggy). The tumble
  // carries on smoothly into the real roll once it arrives (startEvent).
  if (dice.mode === 'ready') {
    const axes = [(2 + Math.random()) * (Math.random() < 0.5 ? -1 : 1), 1 + Math.random()];
    const face = () => 1 + Math.floor(Math.random() * 6);
    const values = Array.from({ length: state.diceCount || 1 }, face);
    dice = { mode: 'spin', waiting: true, seat: dice.seat, value: values.at(-1), values, t0: now, axes };
    sfx('roll');
  }
}

function canRoll() {
  const waiting = rollPending && rollPending.seq === (state?.lastRoll?.seq ?? null) && performance.now() - rollPending.at < 2000;
  return myGo() && !state.rolled && dice.mode === 'ready' && idle() && !waiting;
}

function canMove() {
  return (
    myGo() &&
    state.rolled &&
    state.movable.length > 0 &&
    dice.mode === 'shown' &&
    idle()
  );
}

// ---------------- choosing a roll ----------------

// Move a pin: it starts hopping at once, along the squares it's sure to take, and the server's
// answer (captures, reaching home) joins in on the way. It waits on its last hop if the answer is
// slow, and snaps to the server's board if no answer comes.
function sendMove(token, roll) {
  send('move', { token, roll });
  const seat = playSeat();
  const from = latestTokens?.[seat]?.[token];
  const value = state.rolls?.[roll];
  if (!idle() || from === undefined || !value) return;
  const to = from < 0 ? 0 : from + value;
  const final = latestTokens.map((t, s) => (s === seat ? t.map((p, i) => (i === token ? to : p)) : t));
  const ev = { type: 'move', predicted: true, sentAt: performance.now(), move: { seat, token, from, to, captured: [] }, start: latestTokens, final };
  startEvent(ev, performance.now());
}

// You tapped a pin: with one usable roll it just moves; with several, a small
// chooser pops up above the pin showing the dice you can use on it.
function tapToken(token, layoutItem) {
  const rolls = state.rolls;
  const usable = [];
  state.options.forEach((tokens, i) => {
    if (tokens.includes(token) && !usable.some((j) => rolls[j] === rolls[i])) usable.push(i);
  });
  if (usable.length === 0) return;
  if (usable.length === 1) return sendMove(token, usable[0]);

  const box = els.rollChooser;
  box.innerHTML = '<span class="label">Use</span>';
  const board = boardFor(state.mode);
  for (const i of usable) {
    const b = document.createElement('button');
    b.title = t('Move {n}', { n: rolls[i] });
    const c = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    c.width = c.height = 40 * dpr;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    drawDice(ctx, 20, 19, 34, rolls[i], state.seats[state.turn]?.skins.dice, { color: col(board.colors[state.turn]), sign: board.colors[state.turn], fx: false });
    b.appendChild(c);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      closeChooser();
      sendMove(token, i);
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

let lastBoardDraw = 0;
let lastWasFast = false;
// The board's box, measured only when it changes (measuring it every frame forced the page
// to lay itself out again 60 times a second).
let boardBox = 0;
let boxChangedAt = 0;
new ResizeObserver(([e]) => {
  boardBox = Math.min(e.contentRect.width, e.contentRect.height);
  boxChangedAt = performance.now();
}).observe(els.canvas.parentElement);
let timerShown = '';
function frame(now) {
  requestAnimationFrame(frame);
  // Real elapsed time, so the queue keeps up even when frames are slow (e.g. a background tab).
  const gap = lastFrame ? now - lastFrame : 16;
  // A long pause with no frames (the window was minimised, or frames stopped without the tab
  // being hidden): catch up the same way as coming back from another tab
  if (gap > 1500) catchUp(gap);
  const dt = lastFrame ? Math.min(1000, gap) : 16;
  lastFrame = now;
  if (!state) return;
  stepAnimations(now, dt);
  if (screen !== 'game') return;
  // The board and its effect keep their own time, whatever the pieces are doing
  renderer.drawBackground(now);
  // Full speed (60/s) only while something moves: a token, the rolling dice, a sticker, a burst.
  // The rest of the time only gentle pulses change (turn glow, tokens you can move), and 30/s
  // looks the same while halving the work, which is what keeps phones cool and smooth.
  // (120 Hz phones would otherwise redraw it 120 times a second.)
  const fast = current || dice.mode === 'spin' || floaters.length || renderer.fast;
  if (now - lastBoardDraw < (fast ? 15 : 28)) return;
  if (fast && lastWasFast) watchSmoothness(now - lastBoardDraw);
  lastWasFast = fast;
  lastBoardDraw = now;

  const board = boardFor(state.mode);
  renderer.setBoard(board, myTheme());
  if (!boardBox) {
    const wrap = els.canvas.parentElement.getBoundingClientRect();
    boardBox = Math.min(wrap.width, wrap.height);
  }
  // While the box is still changing size (the phone keyboard sliding in or out) the last drawing
  // is just stretched to fit; the board is redrawn at its new size once it settles. Redrawing the
  // whole board at every step of the slide made opening the chat stutter.
  const target = Math.floor(Math.max(200, boardBox));
  if (renderer.size && target !== renderer.size && now - boxChangedAt < 220) {
    renderer.setCssSize(target);
    turnRing.style.width = turnRing.style.height = `${target}px`;
  } else {
    renderer.resize(target);
    // (back to the size it already had: undo the stretch)
    renderer.setCssSize(renderer.size);
    if (turnRing.style.width !== els.canvas.style.width) turnRing.style.width = turnRing.style.height = els.canvas.style.width;
  }

  const seat = playSeat();
  const active =
    state.phase === 'lobby'
      ? state.seatsAllowed
      : state.decider?.colors || state.seats.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
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
      teams: state.teams ? board.colors.map((_, s) => teamOfColor(s)) : null,
      me: seat,
      // whoever last captured you wears a target (only you see it): capture them back for revenge
      target: state.phase === 'playing' && seat >= 0 ? state.feud?.[seat] : undefined,
    },
    now,
  );

  // Turn timer
  if (state.phase === 'playing' && state.turnDeadline) {
    const left = state.turnDeadline - (Date.now() + clockOffset);
    // Moved with a transform (no page layout), and only when it visibly changes
    const pct = Math.max(0, Math.min(1, left / state.turnTimeout));
    const shown = `${pct.toFixed(2)}|${state.turn}`;
    if (shown !== timerShown) {
      timerShown = shown;
      els.timerBar.style.transform = `scaleX(${pct.toFixed(2)})`;
      els.timerBar.style.background = col(board.colors[state.turn]);
    }
  }
}

function diceView(now, board) {
  if (dice.mode === 'hidden') return null;
  const rolls = state.rolls || [];
  const count = state.diceCount || 1; // two dice on 6-arm boards
  let values = dice.values?.length ? dice.values : [dice.value];
  let bank = dice.mode === 'spin' || dice.mode === 'shown' ? dice.bank || [] : [];
  if (dice.mode === 'ready') values = Array(count).fill(null); // unrolled: "?" on every dice
  if (dice.mode === 'ready' && !state.rolled) bank = rolls; // the rolls kept so far (after a 6)
  if (dice.mode === 'shown' && state.rolled && idle() && rolls.length) {
    // The rolls still to play: the latest one or two are the big dice, the rest wait above
    const big = Math.min(count, rolls.length);
    values = rolls.slice(-big);
    bank = rolls.slice(0, -big);
  }
  return {
    mode: dice.mode,
    waiting: dice.waiting,
    t: now - dice.t0,
    value: values.at(-1),
    values,
    bank,
    axes: dice.axes,
    style: state.seats[dice.seat]?.skins.dice,
    color: col(board.colors[dice.seat]),
    sign: board.colors[dice.seat],
    mine: dice.seat === playSeat(),
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
$('play-now').addEventListener('click', () => sendLobby('play'));
els.codeInput.addEventListener('input', () => {
  els.codeInput.value = els.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});
els.codeForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const code = els.codeInput.value.trim();
  if (code.length !== 4) return toast(t('Room codes are 4 letters or numbers'));
  sendLobby('join', { code });
  els.codeInput.value = '';
});
els.leaveBtn.addEventListener('click', () => sendLobby('leave'));
els.leaveRoomBtn.addEventListener('click', () => {
  setDrawer(false);
  sendLobby('leave');
});
els.quickBtn.addEventListener('click', () => {
  sfx('equip');
  send('setQuick', { quick: !state.quick });
});
els.visibilityBtn.addEventListener('click', () =>
  send('setVisibility', { visibility: state.visibility === 'public' ? 'private' : 'public' }),
);
els.startBtn.addEventListener('click', () => send('start'));
els.fillBtn.addEventListener('click', () => send('fillBots'));
$('lone-btn').addEventListener('click', () => {
  loneSince = 0;
  send('fillBots');
  send('start');
});
els.againBtn.addEventListener('click', () => send('newGame'));
confirmTap(els.surrenderBtn, t('Tap again to surrender'), () => {
  send('surrender');
  setDrawer(false);
});

// ☰ opens and closes the drawer with the menu button, surrender and sound settings
const drawer = $('drawer');
const drawerBtn = $('drawer-btn');
function setDrawer(open) {
  drawer.classList.toggle('open', open);
  drawerBtn.setAttribute('aria-expanded', String(open));
}
drawerBtn.addEventListener('click', () => setDrawer(!drawer.classList.contains('open')));
for (const b of drawer.querySelectorAll('[data-go]')) b.addEventListener('click', () => setDrawer(false));
document.addEventListener('pointerdown', (e) => {
  if (drawer.classList.contains('open') && !drawer.contains(e.target) && !drawerBtn.contains(e.target)) {
    setDrawer(false);
  }
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && drawer.classList.contains('open')) {
    setDrawer(false);
  }
});

confirmTap(
  els.newGameBtn,
  t('Tap again to end this game'),
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

els.canvas.parentElement.addEventListener('pointerdown', () => {
  if (finishTimer) {
    clearTimeout(finishTimer);
    finishTimer = null;
    showFinish();
  }
});

els.canvas.addEventListener('pointerdown', (e) => {
  if (finishTimer) {
    clearTimeout(finishTimer);
    finishTimer = null;
    showFinish();
    return;
  }
  if (canRoll() && renderer.hitDice(e.clientX, e.clientY)) return sendRoll();
  closeChooser(); // tapping anywhere else on the board cancels it
  if (!canMove()) return;
  const token = renderer.hitToken(e.clientX, e.clientY, playSeat(), state.movable);
  if (token === null) return;
  const item = renderer.lastLayout.find((it) => it.seat === playSeat() && it.token === token);
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
  if (kind === 'error') sfx('error');
  els.toast.textContent = text;
  els.toast.className = `toast ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), ms);
}

let popTimer = null;
function showTurnPop(text = t('Your turn!'), sound = 'turn') {
  sfx(sound);
  buzz(sound === 'hurry' ? [40, 60, 40] : [70]);
  els.turnPop.textContent = text;
  els.turnPop.classList.remove('hidden');
  els.turnPop.style.animation = 'none';
  void els.turnPop.offsetWidth;
  els.turnPop.style.animation = '';
  clearTimeout(popTimer);
  popTimer = setTimeout(() => els.turnPop.classList.add('hidden'), 1300);
}

// A short vibration on phones that support it (a no-op elsewhere), only when sounds are on.
function buzz(pattern) {
  if (!audioSettings().sound) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // not allowed here
  }
}

// ---------------- "it's your turn" reminders ----------------
// While the game is waiting for you (to roll, or to pick a move) the board gets a glowing ring
// in your colour, and if you haven't acted you get a soft reminder after a few seconds and a
// "hurry" one just before the turn clock runs out. Nothing when the game moves for you anyway.
const NUDGE_AFTER_MS = 8000;
const HURRY_BEFORE_MS = 5000;
let nudgeKey = null;
let nudgeTimers = [];

function waitingOnMe() {
  if (!state || state.phase !== 'playing' || state.paused) return false;
  const seat = playSeat();
  if (!myGo()) return false;
  if (!state.rolled) return true;
  // rolled: only waiting if there's a real choice to make (a single choice moves by itself)
  const choices = new Set();
  (state.options || []).forEach((o, i) => o.forEach((t) => choices.add(`${state.rolls[i]}:${state.tokens[seat]?.[t]}`)));
  return choices.size > 1;
}

const turnRing = document.getElementById('turn-ring'); // the pulsing your-turn glow round the board

function updateTurnNudge() {
  const waiting = waitingOnMe();
  els.canvas.classList.toggle('my-turn', waiting);
  turnRing.classList.toggle('on', waiting);
  if (waiting) turnRing.style.setProperty('--my-color', col(boardFor(state.mode).colors[playSeat()]));
  const key = waiting ? `${state.roomId}|${state.turn}|${state.seq}|${state.rolled}|${state.rolls?.length}` : null;
  if (key === nudgeKey) return;
  nudgeKey = key;
  for (const t of nudgeTimers) clearTimeout(t);
  nudgeTimers = [];
  if (!waiting) return;
  nudgeTimers.push(setTimeout(() => waitingOnMe() && showTurnPop(t('Still your turn!'), 'nudge'), NUDGE_AFTER_MS));
  const left = (state.turnDeadline || 0) - (Date.now() + clockOffset);
  if (left > HURRY_BEFORE_MS + 1000) {
    nudgeTimers.push(setTimeout(() => waitingOnMe() && showTurnPop(t('5 seconds left!'), 'hurry'), left - HURRY_BEFORE_MS));
  }
}

// 12,480 everywhere; on the menu's little counter, 12.5K / 1B once it gets long
function coinText(n, short = false) {
  try {
    return new Intl.NumberFormat(currentLang(), short && n >= 100_000 ? { notation: 'compact', maximumFractionDigits: 1 } : {}).format(n);
  } catch {
    return String(n);
  }
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

// A colour's name: 'red' -> 'Red' (translated)
function capitalize(s) {
  return t(s[0].toUpperCase() + s.slice(1));
}

// 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st, 102nd
function ordinal(n) {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const en = `${n}${teen ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
  if (currentLang() === 'en') return en;
  return n <= 6 ? t(en) : t('#{n}', { n }); // other languages: their own "1st" … "6th", then #7
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
  const seat = playSeat();
  const p = renderer.lastLayout.find((it) => it.seat === seat && state.movable.includes(it.token));
  return p ? renderer.tokenPoint(p) : null;
};
window.__ludoDicePoint = () => (canRoll() ? renderer.toClient(0, 0) : null);

requestAnimationFrame(frame);
main();

// ---------- menu sounds ----------
// Every button outside the board makes a small sound: tabs flick, Back/Close flick down,
// switches click. Buttons that already play their own sound (Buy, Roll…) aren't doubled up.
function uiSoundFor(b) {
  if (b.dataset.sfx) return b.dataset.sfx;
  if (b.matches('[role=switch], .switch, .toggle, [role=radio], [data-visibility]')) return 'toggle';
  if (b.matches('[role=tab], .tab, [data-ftab], [data-set-tab], [data-lb], #shop-tabs button, .howto-tabs button')) return 'tab';
  if (b.matches('[data-go=menu], .set-close, [aria-label=Close], #settings-close, #inbox-close, #support-close, .item-close, #invite-no, #room-invite-no')) return 'back';
  if (b.matches('[data-go], [data-settings-btn], [data-inbox-btn]')) return 'open';
  return 'click';
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('button, .item, .set-card, select, a[href]');
  if (!b || b.disabled || b.closest('#roll-chooser')) return;
  if (playedJustNow()) return;
  const name = uiSoundFor(b);
  if (name !== 'none') sfx(name);
});
document.addEventListener('change', (e) => e.target.matches('select') && !playedJustNow() && sfx('click'));
// The mouse moving onto a shop card: a faint tick (computers only).
if (window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) {
  let hovered = null;
  document.addEventListener('pointerover', (e) => {
    const card = e.target.closest('#shop-grid .item, #shop-grid .set-card, #shop-tabs button, #menu .btn, #menu .pill-btn');
    if (card === hovered) return;
    hovered = card;
    if (card && !playedJustNow(40)) sfx('hover');
  });
}

// ---------- referrals ----------
// "Invite": Discord's share pop-up. The link carries who shared it; a new player who opens the
// game through it and finishes a game earns the sharer coins (the server pays, once per player).
function renderReferral() {
  const box = $('referral');
  const r = profile?.referrals;
  box.classList.toggle('hidden', !r || !me || me.id.startsWith('guest-')); // guests can't be invited or paid
  if (!r) return;
  $('referral-title').textContent = t('Invite friends: +{coins} coins each', { coins: r.per });
  $('referral-info').textContent = r.count
    ? t('{n} joined through you · {coins} coins earned', { n: r.count, coins: r.coins })
    : t('Paid when they finish their first game');
}
$('referral-btn').addEventListener('click', async () => {
  if (!discordSdk) return toast(t('Invites work inside Discord'));
  try {
    await discordSdk.commands.shareLink({ message: t('Come and play Ludo with me! 🎲'), custom_id: 'ref' });
  } catch {
    toast(t("Couldn't open Discord's share window"));
  }
});
window.addEventListener('ludo-lang', renderReferral);

// ---------- buying gems ----------
// Real money buys VIP Gems only (Gold Coins are earned). The "+" beside the gems (in the shop and
// the menu's top bar) opens the gem store.
const claimPurchases = () => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'claimPurchases' }));
const checkoutWaiters = new Map();
let checkoutSeq = 0;
let webCheckoutAt = 0;
async function openWebCheckout(itemId = '') {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    toast(t('Connecting… try again in a moment.'), 'notice', 3000);
    return;
  }
  try {
    const url = await new Promise((resolve, reject) => {
      const reqId = String(++checkoutSeq);
      const timer = setTimeout(() => {
        checkoutWaiters.delete(reqId);
        reject(new Error('Timed out starting checkout'));
      }, 6000);
      checkoutWaiters.set(reqId, { resolve, reject, timer });
      ws.send(JSON.stringify({ type: 'checkout', reqId, itemId }));
    });
    webCheckoutAt = Date.now();
    if (discordSdk) await discordSdk.commands.openExternalLink({ url });
    else window.open(url, '_blank', 'noopener');
  } catch (err) {
    const detail = err?.message || '';
    if (!/cancel|closed|dismiss|abort/i.test(detail)) {
      toast(detail ? t('Purchase failed: {why}', { why: detail }) : t('Purchase could not be started.'), 'err', 4500);
    }
  }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && webCheckoutAt && Date.now() - webCheckoutAt > 1500) {
    webCheckoutAt = 0;
    claimPurchases();
  }
});
function coinStoreContext() {
  return {
    sdk: discordSdk,
    paid: paidConfig,
    onBought: claimPurchases,
    onWebCheckout: openWebCheckout,
    toast,
    profile,
    starterArt: () => itemPreview(ITEMS[STARTER.item], profile?.equipped?.board || 'board-classic'),
  };
}
// `need`: gems short of something they tried to buy (the store points at the pack that covers it)
function openGemStore(need = 0) {
  const n = Number.isFinite(need) ? need : 0;
  openCoinStore({ ...coinStoreContext(), need: n, needTotal: (profile?.gems ?? 0) + n });
}
for (const b of document.querySelectorAll('#get-coins, [data-get-gems]')) b.addEventListener('click', () => openGemStore());

for (const b of $('quest-tabs').children)
  b.addEventListener('click', () => {
    questTab = b.dataset.qtab;
    renderQuests();
  });

// ---------------- the menu's chat, and Translate ----------------
// Global (everyone) and your language's channel (everyone whose game is set to the same language).
// Only listened to while the Chat panel is open. Anyone's message can be translated into your
// game's language: the server looks the message up and asks the translator.

const langName = (code) => CHAT_LANG[code]?.native || LANGUAGES.find((l) => l.code === code)?.native || code;
// A language's name in the player's own language ("inglés" for a Spanish player), for "Translated from …"
function langInMine(code) {
  try {
    const n = new Intl.DisplayNames([currentLang()], { type: 'language' }).of(code === 'zh' ? 'zh-Hans' : code === 'zh-TW' ? 'zh-Hant' : code);
    if (n && n !== code) return n;
  } catch {}
  return langName(code);
}

function lobbyChatJoin() {
  if (ws?.readyState !== WebSocket.OPEN || !prefs.chat) return;
  lchat.lang = chatLanguage();
  ws.send(JSON.stringify({ type: 'lobbyChat', op: 'join', lang: lchat.lang }));
  chatLangSent = lchat.lang;
}

function lobbyChatPanel(open) {
  const box = $('lobby-chat');
  box.classList.toggle('off', !prefs.chat);
  $('lobby-chat-off').classList.toggle('hidden', prefs.chat);
  $('lobby-chat-lang').textContent = langName(chatLanguage());
  if (open && prefs.chat && (!lchat.open || lchat.lang !== chatLanguage())) {
    lchat.open = true;
    lobbyChatJoin();
  } else if ((!open || !prefs.chat) && lchat.open) {
    lchat.open = false;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'lobbyChat', op: 'leave' }));
  }
  renderLobbyChat();
}

function updateChatDot() {
  const any = !!(lchat.unseenTab || dmState.unread > 0);
  document.querySelector('[data-dot="chat"]')?.classList.toggle('hidden', !any);
}

const dmState = { threads: [], activeId: '', friend: null, msgs: [], unread: 0 };
let lobbyReply = null;
function formatReplyPreview(text) {
  return String(text || '')
    .replace(/:([a-z0-9-]+):/g, (m, slug) => (EMOTE_SLUGS[slug] ? `[${EMOTE_SLUGS[slug].name}]` : m))
    .replace(/\s+/g, ' ')
    .trim();
}
function ensureReplyBar(container, formEl, onCancel) {
  let bar = container.querySelector(':scope > .reply-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'reply-bar hidden';
    container.insertBefore(bar, formEl);
  }
  bar._onCancel = onCancel;
  return bar;
}
function renderReplyBar(bar, target) {
  bar.classList.toggle('hidden', !target);
  bar.innerHTML = '';
  if (!target) return;
  const txt = document.createElement('span');
  txt.className = 'reply-bar-text';
  const strong = document.createElement('b');
  strong.textContent = target.name || 'Player';
  txt.append(document.createTextNode(`${t('Replying to')} `), strong);
  const pv = formatReplyPreview(target.text);
  if (pv) txt.append(document.createTextNode(`: ${pv}`));
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'reply-cancel';
  cancel.setAttribute('aria-label', t('Cancel'));
  cancel.textContent = '✕';
  for (const ev of ['pointerdown', 'mousedown']) cancel.addEventListener(ev, (e) => e.preventDefault());
  cancel.addEventListener('click', () => bar._onCancel?.());
  bar.append(txt, cancel);
}
function setRoomReply(box, msg) {
  box._reply = msg ? { id: msg.id, name: msg.name, text: msg.text } : null;
  const bar = ensureReplyBar(box, box.querySelector('.chat-form'), () => setRoomReply(box, null));
  renderReplyBar(bar, box._reply);
  if (msg) box.querySelector('.chat-form input')?.focus({ preventScroll: true });
}
function setLobbyReply(msg) {
  lobbyReply = msg ? { id: msg.id, name: msg.name, text: msg.text } : null;
  const box = $('lobby-chat');
  const bar = ensureReplyBar(box, $('lobby-chat-form'), () => setLobbyReply(null));
  renderReplyBar(bar, lobbyReply);
  if (msg) $('lobby-chat-input')?.focus({ preventScroll: true });
}
function openDm(friendId, fallbackName = '') {
  closePlayerCardModal();
  setLobbyReply(null);
  lchat.tab = 'dm';
  dmState.activeId = friendId;
  if (!dmState.friend || dmState.friend.id !== friendId) dmState.friend = { id: friendId, name: fallbackName || 'Player', avatar: !String(friendId).startsWith('guest-') };
  if (screen !== 'menu') showScreen('menu');
  setPanel('chat');
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'dm', op: 'open', friendId }));
}
function sendActiveLobbyOrDm(text, replyId = null) {
  if (!text || ws?.readyState !== WebSocket.OPEN) return;
  if (lchat.tab === 'dm') {
    if (!dmState.activeId) return;
    ws.send(JSON.stringify({ type: 'dm', op: 'say', toId: dmState.activeId, text, ...(replyId ? { replyId } : {}) }));
  } else {
    ws.send(JSON.stringify({ type: 'lobbyChat', op: 'say', channel: lchat.tab, text, ...(replyId ? { replyId } : {}) }));
  }
}
function onDmMessage(msg) {
  if (typeof msg.unread === 'number') dmState.unread = msg.unread;
  if (msg.type === 'dmSummary') {
    dmState.threads = msg.threads || [];
  } else if (msg.type === 'dmHistory') {
    dmState.activeId = msg.friendId;
    dmState.friend = msg.friend;
    dmState.msgs = msg.msgs || [];
    if (msg.threads) dmState.threads = msg.threads;
  } else if (msg.type === 'dmReact') {
    if (dmState.activeId === msg.friendId) {
      const target = dmState.msgs.find((m) => m.id === msg.id);
      if (target) {
        if (Object.keys(msg.reactions || {}).length) target.reactions = msg.reactions;
        else delete target.reactions;
        if (lchat.tab === 'dm') {
          const line = $('lobby-chat-log').querySelector(`.chat-line[data-msg-id="${msg.id}"]`);
          if (line) syncLineReacts(line, target.reactions, (emoji) => sendLobbyOrDmReact(msg.id, emoji));
        }
      }
    }
    return;
  } else if (msg.type === 'dmMsg') {
    const isCurrent = lchat.tab === 'dm' && dmState.activeId === msg.friendId && ($('menu').dataset.panel === 'chat' || wide.matches);
    if (dmState.activeId === msg.friendId) {
      dmState.msgs.push(msg.msg);
      if (dmState.msgs.length > 60) dmState.msgs.splice(0, dmState.msgs.length - 60);
    }
    if (isCurrent && msg.msg.from !== me?.id && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'dm', op: 'open', friendId: msg.friendId }));
    } else if (msg.msg.from !== me?.id) {
      sfx('chat');
    }
    if (ws?.readyState === WebSocket.OPEN && !isCurrent) ws.send(JSON.stringify({ type: 'dm', op: 'list' }));
  }
  updateChatDot();
  renderLobbyChat();
}

function sendLobbyOrDmReact(msgId, emoji) {
  if (ws?.readyState !== WebSocket.OPEN) return;
  if (lchat.tab === 'dm') {
    if (!dmState.activeId) return;
    ws.send(JSON.stringify({ type: 'dm', op: 'react', toId: dmState.activeId, id: msgId, emoji }));
  } else {
    ws.send(JSON.stringify({ type: 'lobbyChat', op: 'react', channel: lchat.tab, id: msgId, emoji }));
  }
}

function onLobbyChat(msg) {
  if (msg.op === 'history') {
    lchat.lang = msg.lang;
    lchat.global = msg.global || [];
    lchat.local = msg.local || [];
  } else if (msg.op === 'msg') {
    const list = msg.channel === 'lang' ? lchat.local : lchat.global;
    list.push(msg.msg);
    if (list.length > 80) list.splice(0, list.length - 80);
    if (msg.channel !== lchat.tab && msg.msg.userId !== me?.id && !isHiddenUser(msg.msg.userId)) lchat.unseen[msg.channel] = true;
    if (msg.msg.userId !== me?.id && !isHiddenUser(msg.msg.userId) && msg.channel === lchat.tab) sfx('chat');
  } else if (msg.op === 'react') {
    const list = msg.channel === 'lang' ? lchat.local : lchat.global;
    const target = list.find((m) => m.id === msg.id);
    if (target) {
      if (Object.keys(msg.reactions || {}).length) target.reactions = msg.reactions;
      else delete target.reactions;
      if (msg.channel === lchat.tab) {
        const line = $('lobby-chat-log').querySelector(`.chat-line[data-msg-id="${msg.id}"]`);
        if (line) syncLineReacts(line, target.reactions, (emoji) => sendLobbyOrDmReact(msg.id, emoji));
      }
    }
    return;
  } else if (msg.op === 'ping') {
    if (msg.userId !== me?.id && !isHiddenUser(msg.userId) && $('menu').dataset.panel !== 'chat') {
      lchat.unseen[msg.channel] = true;
      lchat.unseenTab = true;
      updateChatDot();
    }
    return;
  } else if (msg.op === 'removed') {
    const list = msg.channel === 'lang' ? lchat.local : lchat.global;
    const i = list.findIndex((m) => m.id === msg.id);
    if (i >= 0) list.splice(i, 1);
  }
  renderLobbyChat();
}

const isStickerOnly = (text) => text.trim().split(/\s+/).every((w) => EMOTE_SLUGS[/^:([a-z0-9-]+):$/.exec(w)?.[1]]);
let reactPopEl = null;
function closeReactPop() {
  reactPopEl?.classList.add('hidden');
}
function openReactPop(anchor, reactions, onPick) {
  if (!reactPopEl) {
    reactPopEl = document.createElement('div');
    reactPopEl.className = 'react-pop hidden';
    reactPopEl.setAttribute('role', 'menu');
    for (const ev of ['pointerdown', 'mousedown']) {
      reactPopEl.addEventListener(ev, (e) => {
        if (e.target.closest('button')) e.preventDefault();
      });
    }
    document.body.appendChild(reactPopEl);
    document.addEventListener('click', (e) => {
      if (!reactPopEl.contains(e.target) && !e.target.closest('.line-act-react')) closeReactPop();
    });
    window.addEventListener('keydown', (e) => e.key === 'Escape' && closeReactPop());
  }
  const sameAnchor = !reactPopEl.classList.contains('hidden') && reactPopEl._anchor === anchor;
  if (sameAnchor) return closeReactPop();
  reactPopEl._anchor = anchor;
  reactPopEl.innerHTML = '';
  for (const emoji of REACTION_EMOJIS) {
    const b = document.createElement('button');
    b.type = 'button';
    if (reactions?.[emoji]?.includes(me?.id)) b.className = 'mine';
    b.textContent = emoji;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      closeReactPop();
      onPick(emoji);
    });
    reactPopEl.appendChild(b);
  }
  reactPopEl.classList.remove('hidden');
  const r = anchor.getBoundingClientRect();
  const vv = window.visualViewport;
  const vw = vv ? vv.offsetLeft + vv.width : window.innerWidth;
  const ceiling = (vv ? vv.offsetTop : 0) + 8;
  const w = reactPopEl.offsetWidth;
  const h = reactPopEl.offsetHeight;
  const top = r.top - h - 6 >= ceiling ? r.top - h - 6 : r.bottom + 6;
  const left = Math.max(8, Math.min(vw - w - 8, r.right - w));
  reactPopEl.style.top = `${top}px`;
  reactPopEl.style.left = `${left}px`;
}
function syncLineReacts(line, reactions, onPick) {
  let bar = line.querySelector('.msg-reacts');
  const entries = Object.entries(reactions || {}).filter(([, ids]) => ids?.length);
  if (!entries.length) {
    bar?.remove();
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'msg-reacts';
    for (const ev of ['pointerdown', 'mousedown']) bar.addEventListener(ev, (e) => e.target.closest('button') && e.preventDefault());
    line.appendChild(bar);
  }
  bar.innerHTML = '';
  for (const [emoji, ids] of entries) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = `react-pill${ids.includes(me?.id) ? ' mine' : ''}`;
    pill.textContent = `${emoji} ${ids.length}`;
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      onPick(emoji);
    });
    bar.appendChild(pill);
  }
}
function appendReplyQuote(parentEl, replyTo, logEl) {
  const q = document.createElement('button');
  q.type = 'button';
  q.className = 'reply-quote';
  const b = document.createElement('b');
  b.textContent = replyTo.name || 'Player';
  const txt = document.createElement('span');
  txt.textContent = formatReplyPreview(replyTo.text);
  txt.dir = 'auto';
  q.append(document.createTextNode('↩ '), b, txt);
  q.addEventListener('click', (e) => {
    e.stopPropagation();
    const hit = logEl?.querySelector(`.chat-line[data-msg-id="${replyTo.id}"]`);
    if (!hit) return;
    hit.scrollIntoView({ block: 'center', behavior: 'smooth' });
    hit.classList.remove('reply-flash');
    void hit.offsetWidth;
    hit.classList.add('reply-flash');
  });
  parentEl.appendChild(q);
}
// 1 to 3 emoji and nothing else
const isJumbo = (text) => {
  const s = String(text || '').trim();
  if (!s || s.length > 24 || /[\p{L}\p{N}]/u.test(s)) return false;
  const marks = s.match(/\p{Extended_Pictographic}/gu) || [];
  return marks.length >= 1 && marks.length <= 3 && !s.replace(/[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200d\ufe0f\s]/gu, '');
};

function buildChatLine({ msg: m, isMe, scope, logEl, stickerOnly, showTime, onReply, onReact }) {
  const line = document.createElement('div');
  line.className = 'chat-line';
  line.dataset.msgId = m.id;
  // a tap shows its Reply / React (on phones there's no hover); it doesn't take the focus, so the
  // keyboard stays up while you type
  line.addEventListener('click', (e) => {
    if (e.target.closest('button, a, input, textarea, form')) return;
    const on = !line.classList.contains('acts-on');
    for (const l of document.querySelectorAll('.chat-line.acts-on')) l.classList.remove('acts-on');
    line.classList.toggle('acts-on', on);
  });
  // a few emoji on their own: shown big, without a bubble
  if (!stickerOnly && isJumbo(m.text)) line.classList.add('jumbo');
  const row = document.createElement('div');
  row.className = 'chat-line-row';
  const content = document.createElement('div');
  content.className = 'chat-line-content';
  // The words in their own box, which reads right to left for Arabic (dir="auto"): the time and
  // Translate don't get mixed into the sentence, and an Arabic line sits on the right.
  const words = document.createElement('span');
  words.className = 'msg-text';
  words.dir = 'auto';
  renderChatTokens(words, m.text, logEl, stickerOnly);
  content.appendChild(words);
  if (isRtlText(m.text)) content.dir = 'rtl';
  if (showTime) {
    const when = document.createElement('time');
    when.className = 'when';
    when.dir = 'auto'; // "04:52 PM", not "PM 04:52", next to an Arabic line
    when.textContent = new Date(m.at).toLocaleTimeString(document.documentElement.lang || undefined, { hour: '2-digit', minute: '2-digit' });
    content.appendChild(when);
  }
  // (nothing to translate in emoji and stickers alone)
  if (!stickerOnly && !isMe && scope && scope !== 'dm' && hasWords(m.text)) addTranslate(content, scope, m.id);
  const acts = document.createElement('div');
  acts.className = 'line-acts';
  for (const ev of ['pointerdown', 'mousedown']) acts.addEventListener(ev, (e) => e.target.closest('button') && e.preventDefault());
  const replyBtn = document.createElement('button');
  replyBtn.type = 'button';
  replyBtn.className = 'line-act';
  replyBtn.title = t('Reply');
  replyBtn.setAttribute('aria-label', t('Reply'));
  replyBtn.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 4L2.5 8l4 4M3 8h6.5a4 4 0 0 1 4 4v.5" /></svg>';
  replyBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onReply(m);
  });
  const reactBtn = document.createElement('button');
  reactBtn.type = 'button';
  reactBtn.className = 'line-act line-act-react';
  reactBtn.title = t('React');
  reactBtn.setAttribute('aria-label', t('React'));
  reactBtn.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" /><circle cx="6" cy="6.6" r=".8" fill="currentColor" stroke="none" /><circle cx="10" cy="6.6" r=".8" fill="currentColor" stroke="none" /><path d="M5.6 9.6a3.1 3.1 0 0 0 4.8 0" /></svg>';
  reactBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openReactPop(reactBtn, m.reactions, (emoji) => onReact(m, emoji));
  });
  acts.append(replyBtn, reactBtn);
  row.append(content, acts);
  line.appendChild(row);
  syncLineReacts(line, m.reactions, (emoji) => onReact(m, emoji));
  return line;
}
// Right-to-left when the first letter is Arabic, Hebrew, Persian...
const isRtlText = (text) => {
  const first = /[\p{L}]/u.exec(String(text).replace(/:[a-z0-9-]+:/g, ''));
  return !!first && /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/.test(first[0]);
};
const hasWords = (text) => /\p{L}{2}/u.test(String(text).replace(/:[a-z0-9-]+:/g, ''));

function renderChatTokens(target, text, logEl, stickerOnly) {
  for (const part of text.split(/(:[a-z0-9-]+:)/g)) {
    const slug = /^:([a-z0-9-]+):$/.exec(part)?.[1];
    const hit = slug && EMOTE_SLUGS[slug];
    if (hit) {
      const img = document.createElement('img');
      img.className = stickerOnly ? 'chat-sticker' : 'chat-emote';
      img.src = hit.img;
      img.alt = `:${slug}:`;
      img.title = hit.name;
      img.addEventListener('load', () => keepAtBottom(logEl));
      target.appendChild(img);
    } else if (part) target.appendChild(document.createTextNode(part));
  }
}

let pcardEl = null;
let pcardUser = null;
function ensurePlayerCardModal() {
  if (pcardEl) return pcardEl;
  pcardEl = document.createElement('div');
  pcardEl.className = 'modal-wrap pcard-modal hidden';
  pcardEl.setAttribute('role', 'dialog');
  pcardEl.setAttribute('aria-modal', 'true');
  document.body.appendChild(pcardEl);
  let downOnBackdrop = false;
  pcardEl.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === pcardEl; });
  pcardEl.addEventListener('click', (e) => {
    if (downOnBackdrop && e.target === pcardEl) closePlayerCardModal();
    downOnBackdrop = false;
  });
  window.addEventListener('keydown', (e) => e.key === 'Escape' && !pcardEl.classList.contains('hidden') && closePlayerCardModal());
  return pcardEl;
}
function closePlayerCardModal() {
  pcardEl?.classList.add('hidden');
  pcardUser = null;
}
function inspectPlayer(userId, fallbackName = '') {
  if (!userId || userId === 'system' || String(userId).startsWith('bot-')) return;
  const modal = ensurePlayerCardModal();
  pcardUser = { id: userId, name: fallbackName || 'Player' };
  modal.innerHTML = `<div class="modal-card pcard-box"><button type="button" class="set-close pcard-close" aria-label="${t('Close')}"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button><p class="lb-note">${t('Loading…')}</p></div>`;
  modal.querySelector('.pcard-close').addEventListener('click', closePlayerCardModal);
  modal.classList.remove('hidden');
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'inspect', userId }));
}
function refreshInspectedPlayer() {
  if (!pcardUser || !pcardEl || pcardEl.classList.contains('hidden')) return;
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'inspect', userId: pcardUser.id }));
}
function renderPlayerCardModal(u) {
  if (!u || !pcardEl || pcardEl.classList.contains('hidden')) return;
  pcardUser = u;
  const titleText = u.title && BADGES_BY_ID[u.title] ? t(BADGES_BY_ID[u.title].title) : t('Ludo player');
  const badges = u.badges || {};
  const earnedBadges = BADGES.filter((b) => (badges[b.id] || 0) > 0);
  const earnedLevels = earnedBadges.reduce((n, b) => n + (badges[b.id] || 0), 0);
  const pins = (u.pins || []).filter((id) => BADGES_BY_ID[id]);
  const tierNames = ['Bronze', 'Silver', 'Gold'];
  const pinHtml = pins.length
    ? `<div class="pcard-pins">${pins.map((id) => medalHtml(BADGES_BY_ID[id], badges[id] || 1, 'tiny')).join('')}</div>`
    : '';
  const badgesHtml = earnedBadges.length
    ? `<div class="pcard-badge-grid">${earnedBadges
        .map((b) => {
          const lvl = badges[b.id] || 0;
          const pinned = pins.includes(b.id);
          return `<div class="pcard-badge-pill${pinned ? ' pinned' : ''}" title="${escapeHtml(`${t(b.name)} · ${t(tierNames[lvl - 1] || 'Bronze')}`)}">${medalHtml(b, lvl, 'small')}<span><b>${escapeHtml(t(b.name))}</b><small>${escapeHtml(t(tierNames[lvl - 1] || 'Bronze'))}</small></span></div>`;
        })
        .join('')}</div>`
    : `<p class="pcard-empty">${escapeHtml(t('No badges earned yet'))}</p>`;

  pcardEl.innerHTML = `
    <div class="modal-card pcard-box${u.vip ? ' vip' : ''}">
      <div class="pcard-topbar">
        <button type="button" class="set-close pcard-close" aria-label="${t('Close')}"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        ${u.friendState !== 'self' ? `<div class="pcard-more-wrap"><button type="button" class="set-close pcard-more" aria-label="${t('More options')}" aria-expanded="false"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.75" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.75" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.75" fill="currentColor" stroke="none"/></svg></button><div class="pcard-menu hidden" role="menu"></div></div>` : ''}
      </div>
      <div class="pcard-head">
        <span class="avatar pcard-av"></span>
        <div class="pcard-meta">
          <div class="pcard-name-row"><b class="pcard-name${u.vip ? ' vip' : ''}">${u.vip ? '👑 ' : ''}${escapeHtml(u.name)}</b><span class="level-badge">${escapeHtml(t('Lv. {n}', { n: u.level || 1 }))}</span></div>
          <small class="pcard-title">${escapeHtml(titleText)}</small>
          ${pinHtml}
        </div>
        <div class="pcard-top-act"></div>
      </div>
      <div class="pcard-stats">
        <div><b>${(u.stats?.games ?? 0).toLocaleString()}</b><small>${t('Games')}</small></div>
        <div><b>${(u.stats?.wins ?? 0).toLocaleString()}</b><small>${t('Wins')}</small></div>
        <div><b>${(u.stats?.captures ?? 0).toLocaleString()}</b><small>${t('Captures')}</small></div>
        <div><b>${(u.stats?.sixes ?? 0).toLocaleString()}</b><small>${t('Sixes')}</small></div>
      </div>
      <div class="pcard-badges">
        <div class="pcard-sec-head"><span>${t('Badges')}</span><small>${earnedLevels}/${BADGES.length * LEVELS.length}</small></div>
        ${badgesHtml}
      </div>
      <div class="pcard-foot"></div>
    </div>`;
  pcardEl.querySelector('.pcard-close').addEventListener('click', closePlayerCardModal);
  const av = pcardEl.querySelector('.pcard-av');
  fillAvatar(av, { id: u.id, name: u.name, avatar: u.avatar });
  setFrame(av, u.frame);

  // Top action: Add as friend / Requested / Accept / Friends
  const topAct = pcardEl.querySelector('.pcard-top-act');
  if (u.friendState === 'friends') {
    const tag = document.createElement('span');
    tag.className = 'pcard-tag';
    tag.textContent = `✓ ${t('Friends')}`;
    topAct.appendChild(tag);
  } else if (u.friendState === 'sent') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small';
    b.textContent = t('Requested');
    b.addEventListener('click', () => ws?.send(JSON.stringify({ type: 'friend', op: 'cancel', id: u.id })));
    topAct.appendChild(b);
  } else if (u.friendState === 'incoming') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn primary small';
    b.textContent = t('Accept');
    b.addEventListener('click', () => ws?.send(JSON.stringify({ type: 'friend', op: 'accept', id: u.id })));
    topAct.appendChild(b);
  } else if (u.friendState === 'none' && !u.blocked) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small';
    b.textContent = t('Add as friend');
    b.addEventListener('click', () => ws?.send(JSON.stringify({ type: 'friend', op: 'add', id: u.id })));
    topAct.appendChild(b);
  }

  // Top-right 3-dots menu: Mute, Block, Remove as friend (if friends)
  const moreBtn = pcardEl.querySelector('.pcard-more');
  const menu = pcardEl.querySelector('.pcard-menu');
  if (moreBtn && menu) {
    const addMenuItem = (label, cls, fn) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      if (cls) item.className = cls;
      item.textContent = label;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.add('hidden');
        moreBtn.setAttribute('aria-expanded', 'false');
        fn();
      });
      menu.appendChild(item);
    };
    addMenuItem(muted.has(u.id) ? t('Unmute') : t('Mute'), '', () => {
      toggleMute(u.id);
      renderPlayerCardModal(u);
    });
    if (u.friendState !== 'guest') {
      addMenuItem(u.blocked ? t('Unblock') : t('Block'), u.blocked ? '' : 'danger', () => {
        ws?.send(JSON.stringify({ type: 'friend', op: u.blocked ? 'unblock' : 'block', id: u.id }));
      });
    }
    if (u.friendState === 'friends') {
      addMenuItem(t('Remove friend'), 'danger', () => {
        ws?.send(JSON.stringify({ type: 'friend', op: 'remove', id: u.id }));
      });
    }
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = menu.classList.toggle('hidden');
      moreBtn.setAttribute('aria-expanded', String(!open));
    });
    pcardEl.querySelector('.pcard-box').addEventListener('click', () => {
      menu.classList.add('hidden');
      moreBtn.setAttribute('aria-expanded', 'false');
    });
  }

  // Bottom primary Message button (no emoji)
  const foot = pcardEl.querySelector('.pcard-foot');
  if (u.friendState !== 'self' && u.friendState !== 'guest' && !u.blocked) {
    const msgBtn = document.createElement('button');
    msgBtn.type = 'button';
    msgBtn.className = 'btn primary pcard-msg-btn';
    msgBtn.textContent = t('Message');
    msgBtn.addEventListener('click', () => openDm(u.id, u.name));
    foot.appendChild(msgBtn);
  } else if (u.blocked) {
    const note = document.createElement('p');
    note.className = 'pcard-empty';
    note.textContent = t('You blocked this player');
    foot.appendChild(note);
  }
}

function renderLobbyChat() {
  for (const b of document.querySelectorAll('[data-lchat]')) {
    const tab = b.dataset.lchat;
    b.classList.toggle('active', tab === lchat.tab);
    const hasNew = tab === 'dm' ? dmState.unread > 0 : !!lchat.unseen[tab] && tab !== lchat.tab;
    b.classList.toggle('has-new', hasNew);
  }
  const dmBar = $('dm-bar');
  const dmList = $('dm-list');
  const log = $('lobby-chat-log');
  const form = $('lobby-chat-form');
  const isDm = lchat.tab === 'dm';
  const dmListMode = isDm && !dmState.activeId;
  dmBar.classList.toggle('hidden', !isDm || dmListMode);
  dmList.classList.toggle('hidden', !dmListMode);
  log.classList.toggle('hidden', dmListMode);
  form.classList.toggle('hidden', dmListMode);

  if (dmListMode) {
    dmList.innerHTML = '';
    const seen = new Set();
    const onlineMap = new Map((friendsData?.friends || []).map((f) => [f.id, !!f.online]));
    const rows = [];
    for (const th of dmState.threads) {
      seen.add(th.id);
      rows.push({ ...th, online: th.online ?? !!onlineMap.get(th.id) });
    }
    for (const f of friendsData?.friends || []) {
      if (!seen.has(f.id)) rows.push({ id: f.id, name: f.name, avatar: f.avatar, online: !!f.online, unread: 0, last: null });
    }
    if (!rows.length) {
      const p = document.createElement('p');
      p.className = 'dm-empty';
      p.textContent = t("No DMs yet. Tap anyone's profile to message them!");
      dmList.appendChild(p);
      return;
    }
    for (const r of rows) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dm-row';
      btn.addEventListener('click', () => openDm(r.id, r.name));
      const av = document.createElement('span');
      av.className = `avatar lchat-av${r.online ? ' online' : ''}`;
      fillAvatar(av, { id: r.id, name: r.name, avatar: r.avatar });
      setFrame(av, r.frame);
      const meta = document.createElement('div');
      meta.className = 'dm-row-meta';
      const b = document.createElement('b');
      if (r.vip) b.className = 'vip';
      b.textContent = (r.vip ? '👑 ' : '') + r.name;
      const small = document.createElement('small');
      small.dir = 'auto';
      small.textContent = r.last ? r.last.text : t('Tap to say hi');
      meta.append(b, small);
      btn.append(av, meta);
      if (r.unread > 0) {
        const badge = document.createElement('span');
        badge.className = 'dm-unread';
        badge.textContent = r.unread > 9 ? '9+' : String(r.unread);
        btn.appendChild(badge);
      }
      dmList.appendChild(btn);
    }
    return;
  }

  if (isDm) {
    const f = dmState.friend || { id: dmState.activeId, name: 'Player' };
    const fOnline = f.online ?? !!friendsData?.friends?.find((x) => x.id === f.id)?.online;
    dmBar.innerHTML = '';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'btn small dm-back';
    back.textContent = '←';
    back.addEventListener('click', () => {
      setLobbyReply(null);
      dmState.activeId = '';
      ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'dm', op: 'list' }));
      renderLobbyChat();
    });
    const whoBtn = document.createElement('button');
    whoBtn.type = 'button';
    whoBtn.className = 'dm-who';
    whoBtn.addEventListener('click', () => inspectPlayer(f.id, f.name));
    const av = document.createElement('span');
    av.className = `avatar lchat-av${fOnline ? ' online' : ''}`;
    fillAvatar(av, { id: f.id, name: f.name, avatar: f.avatar });
    setFrame(av, f.frame);
    const label = document.createElement('span');
    label.textContent = (f.vip ? '👑 ' : '') + f.name;
    if (f.vip) label.style.color = 'var(--gold)';
    whoBtn.append(av, label);
    dmBar.append(back, whoBtn);
  }

  $('lobby-chat-input').placeholder = isDm
    ? t('Message {name}…', { name: dmState.friend?.name || 'friend' })
    : lchat.tab === 'global'
      ? t('Say something to everyone…')
      : t('Say something in {lang}…', { lang: langName(lchat.lang || chatLanguage()) });

  const raw = isDm
    ? dmState.msgs.map((m) => ({ ...m, userId: m.from }))
    : (lchat.tab === 'lang' ? lchat.local : lchat.global).filter((m) => !isHiddenUser(m.userId));
  const msgs = raw;
  const pinned = log._pinned !== false;
  // which messages are new since the last time this list was drawn (they slide in)
  const listKey = isDm ? `dm:${dmState.activeId || ''}` : `${lchat.tab}:${lchat.lang || ''}`;
  const seenBefore = log._seenKey === listKey ? log._seenId || 0 : Infinity;
  log._seenKey = listKey;
  log._seenId = Math.max(0, ...msgs.map((m) => Number(m.id) || 0));
  log.innerHTML = '';
  if (!msgs.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = isDm
      ? t('No messages yet. Say hi!')
      : lchat.tab === 'global'
        ? t('No messages yet. Say hi to everyone!')
        : t('No messages yet. Say hi in {lang}!', { lang: langName(lchat.lang || chatLanguage()) });
    log.appendChild(li);
  }
  const scope = lchat.tab;
  const replyFn = (m) => setLobbyReply(m);
  const reactFn = (m, emoji) => sendLobbyOrDmReact(m.id, emoji);
  let prev = null;
  let lastAt = 0;
  for (const m of msgs) {
    const stickerOnly = isStickerOnly(m.text);
    const isMe = m.userId === me?.id;
    // the time, centred, when a while has passed (as in the game's chat)
    if (m.at && (!lastAt || m.at - lastAt > 5 * 60_000)) {
      const stamp = document.createElement('li');
      stamp.className = 'chat-time';
      stamp.textContent = new Date(m.at).toLocaleTimeString(document.documentElement.lang || undefined, { hour: '2-digit', minute: '2-digit' });
      log.appendChild(stamp);
      prev = null;
    }
    lastAt = m.at || lastAt;
    const line = buildChatLine({ msg: m, isMe, scope: isDm ? 'dm' : scope, logEl: log, stickerOnly, showTime: false, onReply: replyFn, onReact: reactFn });
    if ((Number(m.id) || 0) > seenBefore) line.classList.add('arrive');

    if (!stickerOnly && !m.replyTo && prev && !prev.stickerOnly && prev.userId === m.userId) {
      prev.body.appendChild(line);
      continue;
    }

    const li = document.createElement('li');
    // Like the game's chat: their picture, the name on top, a bubble under it in their own colour
    li.className = `chat-msg lchat-msg${isMe ? ' me' : ''}${m.vip ? ' vip' : ''}${stickerOnly ? ' sticker-only' : ''}`;
    const av = document.createElement('button');
    av.type = 'button';
    av.className = 'avatar chat-av';
    av.setAttribute('aria-label', m.name || '');
    fillAvatar(av, { id: m.userId, name: m.name, avatar: !String(m.userId).startsWith('guest-') });
    setFrame(av, m.frame);
    av.addEventListener('click', () => inspectPlayer(m.userId, m.name));
    li.appendChild(av);
    const col2 = document.createElement('div');
    col2.className = 'chat-col';
    const who = document.createElement('button');
    who.type = 'button';
    who.className = `who who-btn${m.vip ? ' vip' : ''}`;
    who.textContent = (m.vip ? '👑 ' : '') + (m.name || '');
    who.addEventListener('click', () => inspectPlayer(m.userId, m.name));
    col2.appendChild(who);
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    if (m.replyTo) appendReplyQuote(bubble, m.replyTo, log);
    const body = document.createElement('div');
    body.className = 'chat-body lchat-body';
    body.appendChild(line);
    bubble.appendChild(body);
    col2.appendChild(bubble);
    li.appendChild(col2);
    log.appendChild(li);
    prev = stickerOnly ? null : { userId: m.userId, stickerOnly, body };
  }
  log._pinned = pinned;
  keepAtBottom(log);
}

for (const b of document.querySelectorAll('[data-lchat]')) {
  b.addEventListener('click', () => {
    setLobbyReply(null);
    lchat.tab = b.dataset.lchat;
    lchat.unseen[lchat.tab] = false;
    if (lchat.tab === 'dm' && ws?.readyState === WebSocket.OPEN) {
      if (dmState.activeId) ws.send(JSON.stringify({ type: 'dm', op: 'open', friendId: dmState.activeId }));
      else ws.send(JSON.stringify({ type: 'dm', op: 'list' }));
    }
    $('lobby-chat-log')._pinned = true;
    renderLobbyChat();
  });
}
$('lobby-chat-log').addEventListener('scroll', (e) => {
  const l = e.currentTarget;
  if (l.clientHeight) l._pinned = l.scrollHeight - l.scrollTop - l.clientHeight < 40;
});
const lobbySendBtn = $('lobby-chat-form').querySelector('button[type="submit"]');
for (const ev of ['pointerdown', 'mousedown']) lobbySendBtn.addEventListener(ev, (e) => e.preventDefault());
$('lobby-chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('lobby-chat-input');
  const text = input.value.trim();
  if (!text || ws?.readyState !== WebSocket.OPEN) return;
  sendActiveLobbyOrDm(text, lobbyReply?.id || null);
  setLobbyReply(null);
  input.value = '';
  const log = $('lobby-chat-log');
  log._pinned = true;
  keepAtBottom(log);
  if (document.documentElement.classList.contains('kb-open')) input.focus({ preventScroll: true });
});
$('lobby-chat-input').addEventListener('keydown', (e) => e.key === 'Escape' && lobbyReply && setLobbyReply(null));
wireEmojiToggle($('lobby-chat'));

// Translate: one small button after someone else's message. The answer is kept, so the message
// shows it again whenever the chat is redrawn.
const translations = new Map(); // `${scope}:${id}` -> { text, from } | { error } | 'pending'
function addTranslate(li, scope, id) {
  const key = `${scope}:${id}`;
  li.dataset.tr = key;
  const done = translations.get(key);
  if (done && done !== 'pending') return showTranslation(li, done);
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tr-btn';
  b.textContent = 'AI'; // small: a chip beside the bubble
  b.title = t('Translate into {lang}', { lang: langInMine(chatLanguage()) });
  b.setAttribute('aria-label', b.title);
  if (done === 'pending') b.disabled = true;
  b.addEventListener('click', () => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    translations.set(key, 'pending');
    for (const el of document.querySelectorAll(`[data-tr="${key}"] .tr-btn`)) {
      el.disabled = true;
      el.textContent = '…';
      el.classList.add('busy');
    }
    ws.send(JSON.stringify({ type: 'translate', scope, id, to: chatLanguage() }));
  });
  li.appendChild(b);
}
function showTranslation(li, r) {
  li.querySelector('.tr-btn')?.remove();
  li.querySelector('.tr-out')?.remove();
  const out = document.createElement('span');
  out.className = `tr-out${r.error ? ' err' : ''}`;
  out.dir = 'auto';
  if (r.error) out.textContent = translateServer(r.error);
  else if (r.already) out.textContent = t('Already in {lang}', { lang: langInMine(chatLanguage()) });
  else {
    out.textContent = r.text;
    const note = document.createElement('small');
    note.textContent = r.approved ? t('Translated by players') : r.from && CHAT_LANG[r.from] ? t('Translated from {lang}', { lang: langInMine(r.from) }) : t('Translated');
    out.appendChild(note);
    out.appendChild(rateRow(li, r));
  }
  li.appendChild(out);
  const list = li.closest('.chat-log');
  if (list) keepAtBottom(list);
}
// "Rate" under a translation: a small pop-up with the message, the translation, Good / Bad, and
// a box to write a better one (for players who speak both languages)
function rateRow(li, r) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `tr-rate-link${r.voted ? ' rated' : ''}`;
  b.textContent = r.voted ? t('Rated') : t('Rate');
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    openRatePop(li, r, b);
  });
  return b;
}
function openRatePop(li, r, link) {
  document.querySelector('.tr-rate-pop')?.remove();
  const [scope, id] = li.dataset.tr.split(':');
  const original = li.querySelector('.msg-text')?.textContent || '';
  const wrap = document.createElement('div');
  wrap.className = 'tr-rate-pop';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.innerHTML = `
    <form class="tr-rate-card">
      <b class="tr-rate-title"></b>
      <p class="tr-rate-orig" dir="auto"></p>
      <p class="tr-rate-shown" dir="auto"></p>
      <div class="tr-rate-choice" role="radiogroup">
        <button type="button" class="tr-choice" data-v="up">👍 <span></span></button>
        <button type="button" class="tr-choice" data-v="down">👎 <span></span></button>
      </div>
      <label class="tr-rate-edit"><span></span><textarea rows="2" maxlength="300" dir="auto"></textarea></label>
      <div class="tr-rate-actions"><button type="button" class="btn small tr-cancel"></button><button type="submit" class="btn small primary tr-send"></button></div>
    </form>`;
  const $q = (sel) => wrap.querySelector(sel);
  $q('.tr-rate-title').textContent = t('Rate this translation');
  $q('.tr-rate-orig').textContent = original;
  $q('.tr-rate-shown').textContent = r.text;
  $q('[data-v="up"] span').textContent = t('Good');
  $q('[data-v="down"] span').textContent = t('Bad');
  $q('.tr-rate-edit span').textContent = t('Know a better one? Edit it (optional)');
  const box = $q('textarea');
  box.value = r.text;
  $q('.tr-cancel').textContent = t('Cancel');
  $q('.tr-send').textContent = t('Send');
  let choice = r.voted || '';
  const paint = () => {
    for (const c of wrap.querySelectorAll('.tr-choice')) c.classList.toggle('on', c.dataset.v === choice);
    $q('.tr-send').disabled = !choice && box.value.trim() === r.text;
  };
  for (const c of wrap.querySelectorAll('.tr-choice'))
    c.addEventListener('click', () => {
      choice = c.dataset.v;
      if (choice === 'down') box.focus();
      paint();
    });
  box.addEventListener('input', () => {
    if (box.value.trim() !== r.text && !choice) choice = 'down'; // an edit says this one wasn't right
    paint();
  });
  const close = () => {
    wrap.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('click', (e) => e.target === wrap && close());
  $q('.tr-cancel').addEventListener('click', close);
  $q('form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (ws?.readyState !== WebSocket.OPEN) return close();
    const base = { type: 'trFeedback', scope, id: Number(id), to: chatLanguage(), from: r.from || '', shown: r.text };
    const better = box.value.trim();
    if (better && better !== r.text) ws.send(JSON.stringify({ ...base, op: 'suggest', text: better }));
    else if (choice) ws.send(JSON.stringify({ ...base, op: 'vote', up: choice === 'up' }));
    r.voted = choice || 'down';
    link.textContent = t('Rated');
    link.classList.add('rated');
    close();
  });
  paint();
  document.body.appendChild(wrap);
  $q('[data-v="up"]').focus();
}
function onTrFeedback(msg) {
  if (msg.error) return toast(translateServer(msg.error));
  if (msg.op === 'suggest') toast(msg.approved ? t('Thanks! Players agreed: everyone sees your translation now.') : t('Thanks! It replaces the translation once {n} players agree.', { n: 3 }));
  else toast(t('Thanks for rating!'));
}
function onTranslated(msg) {
  const key = `${msg.scope}:${msg.id}`;
  const r = msg.error ? { error: msg.error } : { text: msg.text, from: msg.from, already: !!msg.already, approved: !!msg.approved };
  if (msg.error) translations.delete(key); // they can try again
  else translations.set(key, r);
  for (const li of document.querySelectorAll(`[data-tr="${key}"]`)) {
    if (msg.error) {
      showTranslation(li, r);
      setTimeout(() => {
        li.querySelector('.tr-out')?.remove();
        const [scope, id] = key.split(':');
        if (!li.querySelector('.tr-btn')) addTranslate(li, scope, Number(id));
      }, 4000);
    } else showTranslation(li, r);
  }
}

// ---------------- the Battle Pass ----------------
// This month's track of 30 tiers. XP comes from logging in each day and finishing quests; the free
// lane is everyone's, the premium lane (VIP Gems and the season's exclusive items) is for holders
// of the Battle Pass subscription. Tap a reward you've reached to claim it.
const passSku = () => paidConfig.skus.find((s) => s.id === PASS_SKU_ID)?.sku || null;
let passPrice = null;
async function loadPassPrice() {
  if (passPrice !== null || !discordSdk || !passSku()) return;
  passPrice = '';
  try {
    const { skus } = await discordSdk.commands.getSkus();
    const sku = skus.find((k) => k.id === passSku());
    if (sku?.price) {
      const { PriceUtils } = await import('@discord/embedded-app-sdk');
      passPrice = PriceUtils.formatPrice(sku.price, currentLang());
      renderPass();
    }
  } catch {}
}
// The web checkout's price when that's how they'll pay, else Discord's
const passLabel = () => (paidConfig.webStore && paidConfig.webPrices?.pass) || passPrice;
async function buyPass(btn) {
  if (!discordSdk) return toast(t('The Battle Pass can be bought in the Discord app.'));
  if (paidConfig.webStore && (paidConfig.webPrices?.pass || passSku())) { // every purchase: the web checkout link
    btn.disabled = true;
    try {
      await openWebCheckout(PASS_SKU_ID);
    } finally {
      btn.disabled = false;
    }
    return;
  }
  if (!passSku()) return toast(t('The Battle Pass can be bought in the Discord app.'));
  btn.disabled = true;
  try {
    await discordSdk.commands.startPurchase({ sku_id: passSku() });
    claimPurchases();
  } catch (err) {
    const detail = err?.message || (typeof err === 'string' ? err : err ? JSON.stringify(err) : '');
    if (/cancel|closed|dismiss|abort/i.test(detail)) return;
    const unsupported = err?.code === 4002 || /unsupported command/i.test(detail);
    if (unsupported && paidConfig.webStore) {
      await openWebCheckout(PASS_SKU_ID);
      return;
    }
    console.warn('Battle Pass startPurchase failed:', err);
    const why = [err?.code != null && !String(detail).includes(String(err.code)) ? `[${err.code}]` : '', detail].filter(Boolean).join(' ').trim();
    if (discordSdk.platform === 'mobile') {
      const base = t("Purchases aren't available on Discord mobile yet — open Ludo on Discord Desktop or Web to buy.");
      toast(why && !unsupported ? `${base} (${why})` : base, 'notice', 5500);
    } else {
      toast(why ? t('Purchase failed: {why}', { why }) : t('Purchase could not be started.'), 'err', 4500);
    }
  } finally {
    btn.disabled = false;
  }
}

function passReward(r) {
  const el = document.createElement('div');
  el.className = 'pr';
  if (r.coins) el.innerHTML = `<span class="coin"></span><b>${r.coins}</b>`;
  else if (r.gems) el.innerHTML = `<span class="gem"></span><b>${r.gems}</b>`;
  else if (r.item && ITEMS[r.item]) {
    el.classList.add('pr-item');
    const eye = document.createElement('span');
    eye.className = 'pr-eye';
    eye.setAttribute('aria-hidden', 'true');
    eye.innerHTML = '<svg viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>';
    el.appendChild(eye);
    el.appendChild(itemPreview(ITEMS[r.item], ITEMS[r.item].type === 'board' ? r.item : profile?.equipped.board || 'board-classic'));
    const name = document.createElement('small');
    name.textContent = t(ITEMS[r.item].name);
    el.appendChild(name);
  }
  return el;
}

// The dock's dot: something reached and not claimed
function passDot() {
  const p = profile?.pass;
  const dot = document.querySelector('[data-dot="pass"]');
  if (!dot || !p) return;
  const open = (lane) => Array.from({ length: p.tier }, (_, i) => i + 1).some((n) => !p[lane].includes(n));
  dot.classList.toggle('hidden', !(open('free') || (p.active && open('premium'))));
}

function renderPass() {
  const box = $('pass-card');
  if (!box) return;
  const p = profile?.pass;
  if (!p) {
    box.innerHTML = `<p class="lb-note">${t('Loading…')}</p>`;
    return;
  }
  loadPassPrice();
  const { season, tiers } = passRewards(p.month);
  const inTier = p.tier >= PASS_TIERS ? XP_PER_TIER : p.xp - p.tier * XP_PER_TIER;
  const days = Math.max(0, Math.ceil((p.endsAt - (Date.now() + clockOffset)) / 86_400_000));
  const gemsTotal = tiers.reduce((n, x) => n + (x.premium.gems || 0), 0);
  const exclusive = tiers.filter((x) => x.premium.item).length;
  const claimable = tiers.filter((x) => x.tier <= p.tier && (!p.free.includes(x.tier) || (p.active && !p.premium.includes(x.tier)))).length;
  box.innerHTML = `
    <div class="pass-head">
      <div class="pass-season"><b>${escapeHtml(t(season.name))}</b><small>${t('{n} days left', { n: days })}</small></div>
      <div class="pass-level"><span>${t('Tier')}</span><b>${p.tier}</b><small>/ ${PASS_TIERS}</small></div>
    </div>
    <div class="pass-bar"><i style="width:${Math.round((inTier / XP_PER_TIER) * 100)}%"></i><span>${p.tier >= PASS_TIERS ? t('Track complete!') : t('{xp} / {need} XP to tier {n}', { xp: inTier, need: XP_PER_TIER, n: p.tier + 1 })}</span></div>
    <p class="pass-earn">${t('Earn XP: daily login +{a} · each daily quest +{b} · each weekly quest +{c}', { a: PASS_XP.login, b: PASS_XP.daily, c: PASS_XP.weekly })}</p>
    ${
      p.active
        ? `<div class="pass-status on">👑 <span>${t('Battle Pass active until {date}', { date: escapeHtml(new Date(p.until || p.endsAt).toLocaleDateString(document.documentElement.lang || undefined, { day: 'numeric', month: 'short' })) })}</span></div>`
        : `<div class="pass-status buy">
            <div><b>👑 ${t('Get the Battle Pass')}</b>
            <ul>
              <li>${t('{n} Die Gems over the month', { n: gemsTotal })}</li>
              <li>${t('{n} exclusive items, never sold in the shop', { n: exclusive })}</li>
              <li>${t('A gold name with a crown in chat')}</li>
              <li>${t('Joining late? Every tier you reached unlocks at once')}</li>
            </ul></div>
            <button type="button" class="btn primary" id="pass-buy">${passLabel() ? t('{price} / month', { price: escapeHtml(passLabel()) }) : t('Get it')}</button>
          </div>`
    }
    ${claimable ? `<button type="button" class="btn primary pass-claim-all" id="pass-claim-all">${t('Claim all ({n})', { n: claimable })}</button>` : ''}
    <div class="pass-lanes-head"><span></span><b>${t('Free')}</b><b class="prem">👑 ${t('Battle Pass')}</b></div>
    <ol class="pass-track"></ol>`;
  const track = box.querySelector('.pass-track');
  for (const x of tiers) {
    const li = document.createElement('li');
    const reached = x.tier <= p.tier;
    li.className = `pass-tier${reached ? ' reached' : ''}${x.tier === p.tier + 1 ? ' next' : ''}`;
    const num = document.createElement('span');
    num.className = 'pt-num';
    num.textContent = x.tier;
    li.appendChild(num);
    for (const lane of ['free', 'premium']) {
      const cell = document.createElement('button');
      cell.type = 'button';
      const reward = x[lane];
      const item = reward.item && ITEMS[reward.item];
      cell.className = `pt-cell ${lane}${item ? ' has-item' : ''}`;
      const done = p[lane].includes(x.tier);
      const locked = lane === 'premium' && !p.active;
      cell.appendChild(passReward(reward));
      if (done) {
        cell.classList.add('done');
        if (!item) cell.disabled = true;
      } else if (!reached) {
        cell.classList.add('unreached');
        if (!item) cell.disabled = true;
      } else if (locked) {
        cell.classList.add('locked');
        if (!item) cell.disabled = true;
      } else {
        cell.classList.add('ready');
        if (!item) {
          cell.title = t('Claim');
          cell.addEventListener('click', () => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'pass', op: 'claim', lane, tier: x.tier })));
        }
      }
      if (item) {
        cell.title = t(item.name);
        cell.addEventListener('click', () => openItemView(item, shopContext()));
      }
      li.appendChild(cell);
    }
    track.appendChild(li);
  }
  box.querySelector('#pass-buy')?.addEventListener('click', (e) => buyPass(e.currentTarget));
  box.querySelector('#pass-claim-all')?.addEventListener('click', () => ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'pass', op: 'claimAll' })));
  // the next tier to reach, in view
  if (!box._scrolled) {
    box._scrolled = true;
    requestAnimationFrame(() => track.querySelector('.next')?.scrollIntoView({ block: 'nearest' }));
  }
}
window.addEventListener('ludo-lang', () => profile && renderPass());

// ---------- the hub: dock tabs, their panels, and the sheets ----------
// Friends / Ranking / Quests open a panel: on phones in place of the modes (tap the tab again, or
// Back, for the modes), on wide screens in the column on the right (Quests to start with).
// VIP opens the Shop on its VIP tab; Shop opens the Shop.
const wide = window.matchMedia('(min-width: 900px)');
function setPanel(name) {
  $('menu').dataset.panel = name || '';
  const shown = name || (wide.matches ? 'quests' : '');
  for (const b of document.querySelectorAll('[data-hub-tab]')) {
    const on = b.dataset.hubTab === shown;
    b.classList.toggle('active', on);
    if (['friends', 'ranking', 'quests', 'chat', 'pass'].includes(b.dataset.hubTab)) b.setAttribute('aria-pressed', String(on));
  }
  if (name === 'ranking') fetchLeaderboard();
  if (name === 'pass') renderPass();
  if (name === 'chat' || lchat.open) lobbyChatPanel(name === 'chat');
  if (name === 'chat') {
    lchat.unseenTab = false;
    updateChatDot();
    if (lchat.tab === 'dm' && ws?.readyState === WebSocket.OPEN) {
      if (dmState.activeId) ws.send(JSON.stringify({ type: 'dm', op: 'open', friendId: dmState.activeId }));
      else ws.send(JSON.stringify({ type: 'dm', op: 'list' }));
    }
  }
  $('menu').scrollTop = 0;
}
for (const b of document.querySelectorAll('[data-hub-tab]')) {
  b.addEventListener('click', () => {
    const tab = b.dataset.hubTab;
    if (tab === 'shop') return; // (data-go="shop" opens it)
    const open = $('menu').dataset.panel;
    setPanel(open === tab && !wide.matches ? '' : tab);
  });
}
for (const b of document.querySelectorAll('[data-hub-home]')) b.addEventListener('click', () => setPanel(''));
wide.addEventListener('change', () => setPanel($('menu').dataset.panel));
setPanel('');

// Little dots on the dock: the daily roll is ready (Quests), a friend request is waiting (Friends)
function renderHubDots() {
  const quests = document.querySelector('[data-dot="quests"]');
  if (quests) quests.classList.toggle('hidden', !profile?.dailyReady);
  const friends = document.querySelector('[data-dot="friends"]');
  if (friends) friends.classList.toggle('hidden', $('friends-req-dot').classList.contains('hidden'));
}
new MutationObserver(renderHubDots).observe($('friends-req-dot'), { attributes: true, attributeFilter: ['class'] });

// Sheets (POWER, Stakes Rooms): a bottom sheet on phones, a dialog on wide screens
function openSheet(id) {
  const el = $(id);
  el.classList.remove('hidden');
  el.querySelector('[data-sheet-close]')?.focus();
}
function closeSheets() {
  for (const el of document.querySelectorAll('.sheet-wrap')) el.classList.add('hidden');
}
for (const el of document.querySelectorAll('.sheet-wrap')) {
  let downOnBackdrop = false;
  el.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === el; });
  el.addEventListener('click', (e) => {
    if (downOnBackdrop && e.target === el) closeSheets();
    downOnBackdrop = false;
  });
  for (const x of el.querySelectorAll('[data-sheet-close]')) x.addEventListener('click', closeSheets);
}
window.addEventListener('keydown', (e) => e.key === 'Escape' && closeSheets());

for (const b of document.querySelectorAll('[data-power]')) {
  b.addEventListener('click', () => {
    closeSheets();
    const what = b.dataset.power;
    if (what === 'quick') sendLobby('create', { visibility: 'public', quick: true });
    else sendLobby('create', { visibility: 'public', mode: what });
  });
}

// Stakes Rooms: pick one stake (100 .. 10,000 Gold Coins) with left/right arrows or join an open one
let chosenStake = STAKES[1] || 100;
$('stakes-btn').addEventListener('click', () => {
  renderStakesSheet();
  openSheet('stakes-sheet');
  sendLobby('list');
});
function renderStakesSheet() {
  const create = $('stake-create');
  create.innerHTML = '';
  const have = profile?.coins ?? 0;
  const stakes = STAKES.filter((n) => n > 0);
  const idx = Math.max(0, stakes.indexOf(chosenStake));
  const amount = stakes[idx];
  chosenStake = amount;
  const stepper = document.createElement('div');
  stepper.className = 'stake-stepper';
  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'stake-nav';
  prev.textContent = '‹';
  prev.disabled = idx <= 0;
  prev.addEventListener('click', () => {
    if (idx > 0) (chosenStake = stakes[idx - 1]), renderStakesSheet();
  });
  const card = document.createElement('button');
  card.type = 'button';
  card.className = `stake-opt${have < amount ? ' cant' : ''}`;
  card.innerHTML = `<span class="coin"></span><b>${amount.toLocaleString(currentLang())}</b><small></small>`;
  card.querySelector('small').textContent = t('Pot up to {n}', { n: (amount * 4).toLocaleString(currentLang()) });
  const go = () => {
    if (have < amount) return toast(t('You need {n} more coins', { n: amount - have }));
    closeSheets();
    sendLobby('create', { visibility: 'public', stake: amount, winnerTakeAll: true });
  };
  if (have < amount) card.title = t('You need {n} more coins', { n: amount - have });
  card.addEventListener('click', go);
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'stake-nav';
  next.textContent = '›';
  next.disabled = idx >= stakes.length - 1;
  next.addEventListener('click', () => {
    if (idx < stakes.length - 1) (chosenStake = stakes[idx + 1]), renderStakesSheet();
  });
  stepper.append(prev, card, next);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `btn primary stake-go${have < amount ? ' cant' : ''}`;
  btn.textContent = t('Create room');
  btn.addEventListener('click', go);
  create.append(stepper, btn);
  const list = $('stake-rooms');
  list.innerHTML = '';
  const open = roomList.filter((r) => r.stake && r.winnerTakeAll && r.id !== state?.roomId);
  if (!open.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = t('No All In rooms open right now: make one!');
    list.appendChild(li);
  }
  for (const r of open) {
    const li = document.createElement('li');
    const info = document.createElement('div');
    info.className = 'room-text';
    info.innerHTML = `<div class="room-name"><span></span><span class="room-stake"><span class="coin"></span>${r.stake.toLocaleString(currentLang())}</span></div><div class="room-meta"></div>`;
    info.querySelector('.room-name span').textContent = translateServer(r.name);
    info.querySelector('.room-meta').textContent = `${t(r.label)} · ${t('{n} of {total} seats taken', { n: r.players, total: r.seats })}`;
    const canSit = r.phase === 'lobby' && r.players < r.seats;
    const join = button(canSit ? t('Join') : t('Watch'), () => {
      closeSheets();
      sendLobby('join', { id: r.id });
    });
    li.append(info, join);
    list.appendChild(li);
  }
}
