// The shop's close-up of one item: a big live preview (dice you can roll, tokens that hop, the
// board with its effects, every sticker in a pack), what it is and who sees it, and the price
// with how close you are to it. Opened by tapping an item in the shop.
import { openDemo } from './demo.js';
import { BOARDS } from '../shared/board.js';
import { ownsItem, rarityOf, setRarity, ITEMS, setPrice, SET_DISCOUNT, priceOf, currencyOf, inShop } from '../shared/shop.js';
import { passItemInfo } from '../shared/pass.js';
import { moneyIcon } from './shop-ui.js';
export { rarityOf };
import { BoardRenderer, drawToken, drawDice, drawTumblingDice } from './renderer.js';
import { drawTauntPreview } from './taunts.js';
import { playerColor, BOARD_THEMES } from './skins.js';
import { sceneSwitch, setSceneMode, SCENE_MODES } from './scene.js';
import { t } from './i18n.js';
import { framedAvatar } from './frames.js';
import { sfx } from './audio.js';

const TYPE = {
  dice: { label: 'Dice', desc: 'Rolls in this style whenever it is your turn.', note: 'Seen by the whole table on every roll you make.' },
  token: { label: 'Token', desc: 'Your four tokens in this style, in your seat’s colour.', note: 'Everyone in the room sees your tokens on the board.' },
  board: { label: 'Board', desc: 'A whole new look for the board, with its own effects.', note: 'Only you see your board: everyone plays on the one they picked.' },
  taunt: { label: 'Taunt', desc: 'Pops up over the square whenever you capture someone.', note: 'Everyone in the room sees it.' },
  emote: { label: 'Sticker', desc: 'A sticker to send in chat.', note: 'Send it in chat: everyone in the room sees it.' },
  'emote-pack': { label: 'Sticker pack', desc: '{n} stickers to send in chat.', note: 'Send them in chat: everyone in the room sees them.' },
  frame: { label: 'Profile frame', desc: 'A frame around your picture.', note: 'Everyone sees it: in the menu, on your seat and in the players list.' },
};

const ICONS = {
  dice: '<rect x="4" y="4" width="16" height="16" rx="3.5" /><circle cx="9" cy="9" r=".9" /><circle cx="15" cy="15" r=".9" /><circle cx="12" cy="12" r=".9" />',
  token: '<circle cx="12" cy="6.5" r="2.5" /><path d="M9.5 9.5h5l1.5 8h-8zM6.5 19.5h11" />',
  board: '<rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 10h16M4 14h16M10 4v16M14 4v16" />',
  emote: '<circle cx="12" cy="12" r="8" /><path d="M9 14.5c.8 1 1.8 1.5 3 1.5s2.2-.5 3-1.5M9.5 10h0M14.5 10h0" />',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" />',
  roll: '<rect x="3.5" y="8" width="11" height="11" rx="2.5" /><path d="M10 8V6.5A2.5 2.5 0 0 1 12.5 4h5A2.5 2.5 0 0 1 20 6.5v5a2.5 2.5 0 0 1-2.5 2.5H14.5" /><circle cx="7" cy="11.5" r=".8" /><circle cx="11" cy="15.5" r=".8" />',
  shop: '<path d="M4 9.5 5.5 4.5h13L20 9.5M4 9.5h16M4 9.5c0 1.4 1.1 2.5 2.7 2.5S9.3 10.9 9.3 9.5c0 1.4 1.2 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1.1 2.5 2.6 2.5S20 10.9 20 9.5M5.5 12v7.5h13V12M10 19.5v-4h4v4" />',
};
const ico = (name, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

let el = null; // the dialog, built on first use
let open = null; // { item, ctx: { profile, freeShop, onBuy, onEquip } }
let anim = null; // the preview's draw loop
let roll = null; // { start, faces, axes } while the dice tumbles
let landed = true; // the landing sound has played

function build() {
  el = document.createElement('div');
  el.className = 'modal-wrap item-view hidden';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `
    <div class="modal-card item-card">
      <button type="button" class="set-close item-close" aria-label="Close"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
      <div class="item-left">
        <div class="item-stage"></div>
        <div class="item-actions">
          <button type="button" class="item-action btn small"></button>
          <button type="button" class="item-try btn small"></button>
        </div>
        <div class="item-scene hidden">
          <span class="item-scene-label"></span>
          <div class="seg item-scene-seg" role="radiogroup"></div>
        </div>
      </div>
      <div class="item-right">
        <div class="item-tags"><span class="rarity"></span><span class="item-type"></span></div>
        <h2 class="item-title"></h2>
        <p class="item-desc"></p>
        <p class="item-note"></p>
        <div class="item-buy">
          <div class="item-price"></div>
          <div class="item-progress"><span><i></i></span><small></small></div>
          <button type="button" class="item-main"></button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el);
  let downOnBackdrop = false;
  el.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === el; });
  el.addEventListener('click', (e) => {
    if (downOnBackdrop && e.target === el) closeItemView();
    downOnBackdrop = false;
  });
  el.querySelector('.item-close').addEventListener('click', closeItemView);
  window.addEventListener('keydown', (e) => e.key === 'Escape' && open && closeItemView());
}

// Boards lit like a place (the Sakura board) can be seen by day, at golden hour or at night:
// the player picks here, and the preview (and their games) change straight away.
const MODE_LABEL = { day: '☀️ Day', golden: '🌇 Golden hour', night: '🌙 Night' };
function sceneRow(boardId) {
  const box = el.querySelector('.item-scene');
  const lit = !!BOARD_THEMES[boardId]?.art?.scene;
  box.classList.toggle('hidden', !lit);
  if (!lit) return;
  box.querySelector('.item-scene-label').textContent = t('Time of day');
  const seg = box.querySelector('.item-scene-seg');
  seg.setAttribute('aria-label', t('Time of day'));
  seg.style.gridTemplateColumns = `repeat(${SCENE_MODES.length}, 1fr)`;
  seg.innerHTML = '';
  for (const m of SCENE_MODES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(sceneSwitch.mode === m));
    b.className = sceneSwitch.mode === m ? 'active' : '';
    b.textContent = t(MODE_LABEL[m]);
    b.addEventListener('click', () => {
      setSceneMode(m);
      sceneRow(boardId);
    });
    seg.appendChild(b);
  }
}

// What the player has on now: the demo dresses the rest of the scene in it
const wearing = (profile) => ({ token: profile?.equipped?.token, dice: profile?.equipped?.dice, board: profile?.equipped?.board, taunt: profile?.equipped?.taunt });
function tryButton(items) {
  const btn = el.querySelector('.item-try');
  btn.classList.toggle('hidden', !items);
  btn.innerHTML = `${ico('eye')}<span></span>`;
  btn.querySelector('span').textContent = t('Try it');
  btn.onclick = () => openDemo(items);
}

export function openItemView(item, ctx) {
  if (!el) build();
  open = { item, ctx };
  roll = null;
  buildStage(item, ctx.profile);
  renderInfo();
  el.classList.remove('hidden');
  sfx('open');
  el.querySelector('.item-main').focus({ preventScroll: true });
}

export function closeItemView() {
  if (!el) return;
  el.classList.add('hidden');
  cancelAnimationFrame(anim);
  anim = null;
  open = null;
}

// The shop changed (bought, equipped, language): show the new state if it's open.
export function refreshItemView(ctx) {
  if (!open) return;
  open.ctx = ctx;
  renderInfo();
}

function renderInfo() {
  const { item, ctx } = open;
  if (item.items) return renderSetInfo();
  const { profile, freeShop } = ctx;
  const type = item.type === 'emote' && !item.img ? 'emote' : item.type;
  const info = TYPE[type];
  const rarity = rarityOf(item);
  const iconFor = { dice: 'dice', token: 'token', board: 'board', taunt: 'token' }[type] || 'emote';
  el.querySelector('.item-card').dataset.rarity = rarity.id;
  sceneRow(item.type === 'board' ? item.id : null);
  el.querySelector('.rarity').textContent = `✦ ${t(rarity.label)}`;
  el.querySelector('.item-type').innerHTML = `${ico(iconFor)}<span></span>`;
  el.querySelector('.item-type span').textContent = t(info.label);
  el.querySelector('.item-title').textContent = t(item.name);
  el.querySelector('.item-desc').textContent = t(item.perk || item.desc || info.desc, { n: item.emotes?.length });
  el.querySelector('.item-note').innerHTML = `${ico('eye')}<span></span>`;
  el.querySelector('.item-note span').textContent = t(info.note);
  el.querySelector('.item-close').setAttribute('aria-label', t('Close'));

  const action = el.querySelector('.item-action');
  action.classList.toggle('hidden', type !== 'dice');
  action.innerHTML = `${ico('roll')}<span></span>`;
  action.querySelector('span').textContent = t('Roll the dice');
  action.onclick = startRoll;
  // "Try it": the whole of what it does, on a board (the rest of the look is what you have on)
  tryButton(['token', 'dice', 'board', 'taunt'].includes(type) ? { ...wearing(profile), [type]: item.id } : null);

  const owned = ownsItem(profile, item.id);
  const equipped = profile?.equipped?.[item.type] === item.id;
  const cur = currencyOf(item); // coins, or gems for Legendary and VIP items
  const coins = profile?.[cur] ?? 0;
  const price = priceOf(item) || 0; // (30% off if it is today's deal)
  const short = !owned && !freeShop && coins < price;
  const priceBox = el.querySelector('.item-price');
  priceBox.innerHTML = owned ? `<b class="owned-tag">✓ ${t(equipped ? 'Equipped' : 'Owned')}</b>` : `${moneyIcon(cur)}<b>${freeShop ? `<s>${price}</s> 0` : price < item.price ? `<s>${item.price}</s> ${price}` : price}</b>`;
  const progress = el.querySelector('.item-progress');
  progress.classList.toggle('hidden', !short);
  if (short) {
    progress.querySelector('i').style.width = `${Math.round((100 * coins) / price)}%`;
    progress.querySelector('small').textContent = cur === 'gems' ? t('{n} more gems to go', { n: price - coins }) : t('{n} more coins to go', { n: price - coins });
  }
  const main = el.querySelector('.item-main');
  main.className = 'item-main';
  main.disabled = false;
  if (owned && (equipped || item.type === 'emote' || item.type === 'emote-pack')) {
    main.textContent = equipped ? `${t('Equipped')} ✓` : t('Owned');
    main.disabled = true;
    main.classList.add('done');
  } else if (owned) {
    main.textContent = t('Equip');
    main.classList.add('equip');
    main.onclick = () => ctx.onEquip(item);
  } else if (item.award) {
    // won on the leaderboard, never bought: say how
    main.textContent = `🏆 ${t(item.award)}`;
    main.disabled = true;
    main.classList.add('done');
    priceBox.innerHTML = '';
    progress.classList.add('hidden');
  } else if (item.pass && ctx.canClaim?.(item)) {
    // ready to claim on the Battle Pass track right now
    main.textContent = t('Claim');
    main.classList.add('equip');
    main.onclick = () => ctx.onClaim?.(item);
    priceBox.innerHTML = '';
    progress.classList.add('hidden');
  } else if (item.pass) {
    // a Battle Pass exclusive: explain the tier, how XP works, and let the player open the Battle Pass
    const info = passItemInfo(item.id, profile?.pass?.month);
    const curTier = profile?.pass?.tier || 0;
    const tier = info?.tier;
    const noteEl = document.createElement('span');
    noteEl.className = 'pass-view-note';
    noteEl.textContent = tier
      ? info.lane === 'free'
        ? t('Free reward at Battle Pass Tier {n}. Earn XP from daily logins and quests to reach Tier {n}.', { n: tier })
        : t('Earned at Battle Pass Tier {n}. Unlock the Battle Pass and earn XP from daily logins & quests (your current progress carries over).', { n: tier })
      : t('Earned on the Battle Pass track by logging in daily and finishing quests.');
    priceBox.replaceChildren(noteEl);
    if (tier) {
      progress.classList.remove('hidden');
      progress.querySelector('i').style.width = `${Math.min(100, Math.round((100 * curTier) / tier))}%`;
      progress.querySelector('small').textContent = curTier >= tier
        ? t('Tier {n} reached — unlock Battle Pass to claim!', { n: tier })
        : t('Your Pass progress: Tier {cur} / {n}', { cur: curTier, n: tier });
    } else {
      progress.classList.add('hidden');
    }
    main.textContent = `🎟️ ${t('Open Battle Pass')}`;
    main.classList.add('equip');
    main.onclick = () => ctx.onOpenPass?.();
  } else if (item.starter) {
    // only in the Starter Pack: the button opens the gem store, where it is
    main.textContent = `🎁 ${t('Only in the Starter Pack')}`;
    main.classList.add('equip');
    main.onclick = () => ctx.onGetGems?.();
    priceBox.innerHTML = '';
    progress.classList.add('hidden');
  } else if (item.limited && !inShop(item)) {
    // limited, and not its week in the shop
    main.textContent = `⏳ ${t('Back soon')}`;
    main.disabled = true;
    main.classList.add('done');
    progress.classList.add('hidden');
  } else {
    main.innerHTML = `${ico('shop')}<span></span>`;
    main.querySelector('span').textContent = freeShop ? t('Get free') : t('Buy · {price}', { price });
    main.classList.add('buy');
    if (short) main.classList.add('cant');
    main.onclick = () => ctx.onBuy(item);
  }
}

// A set: what's in it, what it would cost apart, and 10% off that.
function renderSetInfo() {
  sceneRow(open.item.items.find((id) => id.startsWith('board-')));
  const { item: set, ctx } = open;
  const { profile, freeShop } = ctx;
  const { full, price, missing, currency } = setPrice(set, profile);
  el.querySelector('.item-card').dataset.rarity = setRarity(set).id;
  el.querySelector('.rarity').textContent = `−${Math.round(SET_DISCOUNT * 100)}%`;
  el.querySelector('.item-type').innerHTML = `${ico('board')}<span></span>`;
  el.querySelector('.item-type span').textContent = t('Set');
  el.querySelector('.item-title').textContent = t(set.name);
  el.querySelector('.item-desc').textContent = t('Everything in it: {items}.', { items: set.items.map((id) => t(ITEMS[id].name) + ' (' + t(TYPE[ITEMS[id].type].label) + ')').join(', ') });
  el.querySelector('.item-note').innerHTML = `${ico('eye')}<span></span>`;
  el.querySelector('.item-note span').textContent = t('Buying the set puts the whole look on at once. Already own some of it? You pay for the rest, still 10% off.');
  el.querySelector('.item-close').setAttribute('aria-label', t('Close'));
  const action = el.querySelector('.item-action');
  const hasDice = set.items.some((id) => ITEMS[id].type === 'dice');
  action.classList.toggle('hidden', !hasDice);
  action.innerHTML = `${ico('roll')}<span></span>`;
  action.querySelector('span').textContent = t('Roll the dice');
  action.onclick = startRoll;
  tryButton({ ...wearing(profile), ...Object.fromEntries(set.items.map((id) => [ITEMS[id].type, id])) });

  const coins = profile?.[currency] ?? 0;
  const short = missing.length && !freeShop && coins < price;
  const priceBox = el.querySelector('.item-price');
  priceBox.innerHTML = !missing.length ? `<b class="owned-tag">✓ ${t('Owned')}</b>` : `${moneyIcon(currency)}<b><s>${full}</s> ${freeShop ? 0 : price}</b>`;
  const progress = el.querySelector('.item-progress');
  progress.classList.toggle('hidden', !short);
  if (short) {
    progress.querySelector('i').style.width = `${Math.round((100 * coins) / price)}%`;
    progress.querySelector('small').textContent = currency === 'gems' ? t('{n} more gems to go', { n: price - coins }) : t('{n} more coins to go', { n: price - coins });
  }
  const main = el.querySelector('.item-main');
  main.className = 'item-main';
  main.disabled = false;
  if (!missing.length) {
    main.textContent = `${t('Owned')} ✓`;
    main.disabled = true;
    main.classList.add('done');
  } else {
    main.innerHTML = `${ico('shop')}<span></span>`;
    main.querySelector('span').textContent = freeShop ? t('Get free') : t('Buy the set · {price}', { price });
    main.classList.add('buy');
    if (short) main.classList.add('cant');
    main.onclick = () => ctx.onBuySet(set);
  }
}

// ---------- the live preview ----------

function startRoll() {
  const axes = () => [2 + Math.random() * 1.5, 1 + Math.random() * 1.5].map((n) => (Math.random() < 0.5 ? -n : n)); // turns around x and y, either way
  sfx('roll');
  landed = false;
  roll = { start: performance.now(), faces: [1 + Math.floor(Math.random() * 6)], axes: [axes()] };
}

function buildStage(item, profile) {
  const stage = el.querySelector('.item-stage');
  stage.innerHTML = '';
  cancelAnimationFrame(anim);
  if (item.type === 'emote' || item.type === 'emote-pack') {
    const list = item.type === 'emote-pack' ? item.emotes : [{ img: item.img, name: item.name, emoji: item.emoji }];
    const grid = document.createElement('div');
    grid.className = `item-stickers${list.length === 1 ? ' one' : ''}`;
    for (const e of list) {
      const cell = document.createElement('figure');
      if (e.img) {
        const img = document.createElement('img');
        img.src = e.img;
        img.alt = e.name;
        cell.appendChild(img);
      } else cell.textContent = e.emoji;
      if (list.length > 1) {
        const cap = document.createElement('figcaption');
        cap.textContent = e.name;
        cell.appendChild(cap);
      }
      grid.appendChild(cell);
    }
    stage.appendChild(grid);
    return;
  }
  if (item.type === 'frame') {
    // your own picture in it, if we have one
    const avatar = open?.ctx?.avatar;
    const img = avatar ? Object.assign(document.createElement('img'), { src: avatar, alt: '' }) : null;
    const wrap = document.createElement('div');
    wrap.className = 'frame-stage';
    wrap.appendChild(framedAvatar(item.id, img, 150));
    stage.appendChild(wrap);
    return;
  }
  const canvas = document.createElement('canvas');
  stage.appendChild(canvas);
  const pieces = item.items ? Object.fromEntries(item.items.map((id) => [ITEMS[id].type, id])) : null;
  const theme = pieces?.board || profile?.equipped?.board || 'board-classic';
  let boardR = null;
  const off = document.createElement('canvas');
  const fit = () => {
    const w = stage.clientWidth || 420;
    const h = stage.clientHeight || 300;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    return { w, h, dpr };
  };
  const frame = (now) => {
    anim = requestAnimationFrame(frame);
    const { w, h, dpr } = fit();
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    if (pieces) drawSet(c, w, h, pieces, theme, now);
    else if (item.type === 'dice') drawOneDice(c, w, h, item.id, now);
    else if (item.type === 'token') drawTokenRow(c, w, h, item.id, theme, now);
    else if (item.type === 'taunt') drawTauntPreview(c, item.id, w, h, now, { name: t('Blue') });
    else if (item.type === 'board') {
      const size = Math.min(w, h) - 16;
      if (!boardR) {
        boardR = new BoardRenderer(off);
        boardR.setBoard(BOARDS[4], item.id);
      }
      boardR.resize(size);
      boardR.draw({ tokens: [0, 1, 2, 3].map(() => [-1, -1, -1, -1]), active: [0, 1, 2, 3], skins: [], turn: null }, now);
      c.drawImage(off, (w - size) / 2, (h - size) / 2, size, size);
    }
  };
  anim = requestAnimationFrame(frame);
}

const ROLL_MS = 1300;
// One dice in the middle: tossed up, tumbling as a real 3D cube (the board's own dice), landing
// flat. (One, with room round it for its ears, wings or flames, rather than two side by side.)
function drawOneDice(c, w, h, style, now) {
  const size = Math.min(w * 0.3, h * 0.44);
  const p = roll ? Math.min(1, (now - roll.start) / ROLL_MS) : 1;
  const left = 1 - (1 - (1 - p) ** 3); // eases out like the board's roll
  if (roll && p >= 0.9 && !landed) {
    landed = true;
    sfx('land');
  }
  {
    const i = 0;
    const x = w / 2;
    const tumbling = roll && p < 1;
    // up and down once, with a little bounce at the end
    const hop = tumbling ? (Math.sin(Math.PI * Math.min(1, p * 1.15)) * 0.42 + Math.max(0, Math.sin(Math.PI * (p - 0.87) / 0.13)) * 0.08) * size : 0;
    const face = roll ? roll.faces[i] : 5;
    const grow = tumbling ? 1 + 0.12 * Math.sin(Math.PI * p) : 1;
    c.save();
    c.globalAlpha = 0.35 * (1 - Math.min(0.6, hop / (size * 1.2)));
    c.fillStyle = '#000';
    c.beginPath();
    c.ellipse(x, h / 2 + size * 0.52, size * 0.44 * (1 - hop / (size * 2)), size * 0.09, 0, 0, Math.PI * 2);
    c.fill();
    c.restore();

    drawTumblingDice(c, x, h / 2 - hop, size * grow, face, style, tumbling ? left : 0, roll ? roll.axes[i] : [0, 0], { t: now });
  }
}

// A set: its board, with its dice and tokens in front of it
let setBoard = null;
function drawSet(c, w, h, pieces, theme, now) {
  if (pieces.board) {
    const size = Math.min(w, h) - 20;
    if (!setBoard || setBoard.id !== pieces.board) {
      const off = document.createElement('canvas');
      setBoard = { id: pieces.board, off, r: new BoardRenderer(off) };
      setBoard.r.setBoard(BOARDS[4], pieces.board);
    }
    setBoard.r.resize(size);
    setBoard.r.draw({ tokens: [0, 1, 2, 3].map(() => [-1, -1, -1, -1]), active: [0, 1, 2, 3], skins: [], turn: null }, now);
    c.save();
    c.globalAlpha = pieces.token || pieces.dice ? 0.55 : 1;
    c.drawImage(setBoard.off, (w - size) / 2, (h - size) / 2, size, size);
    c.restore();
  }
  if (pieces.dice) {
    c.save();
    c.translate(0, pieces.token ? -h * 0.14 : 0);
    drawOneDice(c, w, h, pieces.dice, now);
    c.restore();
  }
  if (pieces.token) {
    c.save();
    c.translate(0, pieces.dice ? h * 0.2 : 0);
    drawTokenRow(c, w, h * (pieces.dice ? 0.9 : 1), pieces.token, theme, now);
    c.restore();
  }
}

function drawTokenRow(c, w, h, skin, theme, now) {
  const colors = ['red', 'green', 'yellow', 'blue'];
  const r = Math.min(w / 10, h / 4.2);
  colors.forEach((col, i) => {
    const x = w / 2 + (i - 1.5) * r * 2.3;
    const phase = ((now / 1000) * 1.1 - i * 0.22) % 2.2; // each pawn hops in turn
    const lift = phase < 0.5 ? Math.sin((phase / 0.5) * Math.PI) * r * 1.1 : 0;
    drawToken(c, x, h * 0.62, r, playerColor(theme, col), skin, { lift, sign: col, t: now });
  });
}
