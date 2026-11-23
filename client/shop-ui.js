// The shop screen: tabs plus a grid of item cards with drawn previews.
import { SHOP_ITEMS, ITEMS, ownsItem, SETS, setPrice, SET_DISCOUNT, RARITIES, rarityOf, setRarity, ownsItem as owns, dailyDeal, priceOf, DEAL_DISCOUNT, NEW_ITEMS, currencyOf, setCurrency } from '../shared/shop.js';
import { BOARDS } from '../shared/board.js';
import { BoardRenderer, drawToken, drawDice } from './renderer.js';
import { drawTauntPreview } from './taunts.js';
import { playerColor } from './skins.js';
import { t } from './i18n.js';
import { framedAvatar } from './frames.js';

const IN_BASE = [0, 1, 2, 3].map(() => [-1, -1, -1, -1]);

export const SHOP_TABS = [
  { type: 'vip', label: 'VIP' },
  { type: 'set', label: 'Sets' },
  { type: 'token', label: 'Tokens' },
  { type: 'dice', label: 'Dice' },
  { type: 'board', label: 'Boards' },
  { type: 'taunt', label: 'Taunts' },
  { type: 'frame', label: 'Frames' },
  { type: 'emote', label: 'Emotes' },
];

// The coin or gem icon for a price
export const moneyIcon = (currency) => (currency === 'gems' ? '<span class="gem"></span>' : '<span class="coin"></span>');

// ---- "New" tags: items this device hasn't seen in the shop yet ----
const SEEN_KEY = 'ludo-shop-seen';
let seen = null;
function seenSet() {
  if (seen) return seen;
  try {
    const saved = JSON.parse(localStorage.getItem(SEEN_KEY) || 'null');
    if (Array.isArray(saved)) return (seen = new Set(saved));
  } catch {}
  // first visit on this device: everything is known except what this update added
  seen = new Set(SHOP_ITEMS.filter((i) => !NEW_ITEMS.has(i.id)).map((i) => i.id));
  saveSeen();
  return seen;
}
function saveSeen() {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {}
}
const isNew = (id) => !seenSet().has(id);
let shownIds = []; // on the tab you're looking at: they stop being new once you leave it
let shownTab = null;
// Leaving a tab (or the shop): what was on it isn't new any more
export function commitShopSeen() {
  if (!shownIds.length) return;
  for (const id of shownIds) seenSet().add(id);
  shownIds = [];
  saveSeen();
}

// ---- All / To buy / Owned ----
let filter = 'all';
const FILTERS = [
  ['all', 'All'],
  ['buy', 'To buy'],
  ['owned', 'Owned'],
];

export function renderShop({ tabs, grid }, { tab, profile, freeShop = false, onTab, onBuy, onBuySet, onEquip, onView, onGetGems }) {
  if (tab !== shownTab) commitShopSeen();
  shownTab = tab;
  tabs.innerHTML = '';
  for (const st of SHOP_TABS) {
    const b = document.createElement('button');
    b.className = `tab${st.type === tab ? ' active' : ''}${st.type === 'set' ? ' sets-tab' : ''}`;
    b.textContent = t(st.label);
    // a dot on tabs with something new (not the one you're on)
    const inTab = (i) => i.type === st.type || (st.type === 'emote' && i.type === 'emote-pack') || (st.type === 'vip' && currencyOf(i) === 'gems');
    if (st.type !== tab && SHOP_ITEMS.some((i) => inTab(i) && isNew(i.id))) b.classList.add('has-new');
    b.addEventListener('click', () => onTab(st.type));
    tabs.appendChild(b);
  }

  grid.innerHTML = '';
  animated.length = 0;
  const bar = document.createElement('div');
  bar.className = 'shop-filter';
  bar.setAttribute('role', 'group');
  for (const [id, label] of FILTERS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = filter === id ? 'on' : '';
    b.textContent = t(label);
    b.setAttribute('aria-pressed', String(filter === id));
    b.addEventListener('click', () => {
      filter = id;
      onTab(tab);
    });
    bar.appendChild(b);
  }
  grid.appendChild(bar);
  const keep = (owned) => filter === 'all' || (filter === 'owned') === owned;
  const before = grid.children.length;
  const emptyNote = () => {
    if (grid.children.length > before) return;
    const p = document.createElement('p');
    p.className = 'shop-empty';
    p.textContent = filter === 'owned' ? t("You don't own anything here yet.") : t('You own everything here!');
    grid.appendChild(p);
  };
  if (tab === 'set') {
    // cheapest first, like the rarity groups
    const fullPrice = (set) => set.items.reduce((sum, id) => sum + ITEMS[id].price, 0);
    for (const set of [...SETS].sort((a, b) => fullPrice(a) - fullPrice(b))) {
      if (keep(!setPrice(set, profile).missing.length)) grid.appendChild(setCard(set, { profile, freeShop, onBuySet, onView }));
    }
    return emptyNote();
  }
  // VIP: everything paid in gems (frames, Legendary items, Legendary sets), under a gem banner
  if (tab === 'vip') {
    const banner = document.createElement('div');
    banner.className = 'vip-banner';
    banner.innerHTML = `<span class="gem big"></span><div><b>${t('VIP Gems')}</b><small>${t('Frames and Legendary items are paid in gems. Gold Coins stay for everything else, and for stakes rooms.')}</small></div>`;
    const get = document.createElement('button');
    get.type = 'button';
    get.className = 'btn small gem-buy';
    get.innerHTML = `<span class="gem"></span>${t('Get gems')}`;
    get.addEventListener('click', () => onGetGems?.());
    banner.appendChild(get);
    grid.appendChild(banner);
  }
  // Grouped by rarity, cheapest first (Common up to Legendary), each group under its own heading
  const items = SHOP_ITEMS.filter((i) => (tab === 'vip' ? currencyOf(i) === 'gems' && i.price > 0 : i.type === tab || (tab === 'emote' && i.type === 'emote-pack')));
  // Today's deal, on top of its own tab (until you own it)
  const deal = dailyDeal();
  if (deal.type === tab && !owns(profile, deal.id) && !freeShop && filter !== 'owned') {
    const head = document.createElement('h3');
    head.className = 'rarity-head deal-head';
    head.innerHTML = `<span>★ ${t("Today's deal")}</span><small>−${Math.round(DEAL_DISCOUNT * 100)}%</small>`;
    grid.appendChild(head);
    grid.appendChild(itemCard(deal, { profile, freeShop, onBuy, onEquip, onView }));
  }
  for (const rarity of [...RARITIES].reverse()) {
    const all = items.filter((i) => rarityOf(i) === rarity).sort((a, b) => a.price - b.price);
    const group = all.filter((i) => keep(owns(profile, i.id)));
    if (!group.length) continue;
    const head = document.createElement('h3');
    head.className = 'rarity-head';
    head.dataset.rarity = rarity.id;
    // (how many of them you have: the shop doubles as your collection)
    const have = all.filter((i) => owns(profile, i.id)).length;
    head.innerHTML = `<span>✦ ${t(rarity.label)}</span><small>${have} / ${all.length}</small>`;
    if (have === all.length) head.classList.add('complete');
    grid.appendChild(head);
    for (const item of group) grid.appendChild(itemCard(item, { profile, freeShop, onBuy, onEquip, onView }));
  }
  if (tab === 'vip') {
    const gemSets = SETS.filter((set) => setCurrency(set) === 'gems' && keep(!setPrice(set, profile).missing.length));
    if (gemSets.length) {
      const head = document.createElement('h3');
      head.className = 'rarity-head';
      head.dataset.rarity = 'legendary';
      head.innerHTML = `<span>✦ ${t('Legendary sets')}</span>`;
      grid.appendChild(head);
      for (const set of gemSets) grid.appendChild(setCard(set, { profile, freeShop, onBuySet, onView }));
    }
  }
  shownIds = items.map((i) => i.id);
  emptyNote();
}

function clickable(card, label, open) {
  // Tap the card (not its button) for a close-up
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', label);
  card.addEventListener('click', (e) => !e.target.closest('button') && open());
  card.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && e.target === card && (e.preventDefault(), open()));
}

function itemCard(item, { profile, freeShop, onBuy, onEquip, onView }) {
  const owned = ownsItem(profile, item.id);
  const equipped = profile?.equipped[item.type] === item.id;
  const card = document.createElement('div');
  card.className = `item${equipped ? ' equipped' : ''}`;
  card.dataset.rarity = rarityOf(item).id;
  clickable(card, t(item.name), () => onView?.(item));
  if (isNew(item.id)) {
    const tag = document.createElement('span');
    tag.className = 'new-tag';
    tag.textContent = t('New');
    card.appendChild(tag);
  }
  card.appendChild(preview(item, profile?.equipped.board || 'board-classic'));

  const name = document.createElement('div');
  name.className = 'item-name';
  name.textContent = t(item.name);
  card.appendChild(name);

  const btn = document.createElement('button');
  btn.className = 'btn small';
  if ((item.type === 'emote' || item.type === 'emote-pack') && owned) {
    btn.textContent = t('Owned');
    btn.disabled = true;
  } else if (equipped) {
    btn.textContent = `${t('Equipped')} ✓`;
    btn.disabled = true;
  } else if (owned) {
    btn.textContent = t('Equip');
    btn.addEventListener('click', () => onEquip(item));
  } else if (item.award) {
    // won on the leaderboard, never bought
    btn.textContent = `🏆 ${t('Win it')}`;
    btn.classList.add('won');
    btn.title = t(item.award);
    btn.disabled = true;
  } else if (freeShop) {
    btn.innerHTML = `${t('Get free')} <s>${item.price}</s>`;
    btn.classList.add('buy');
    btn.addEventListener('click', () => onBuy(item));
  } else {
    const price = priceOf(item);
    const cur = currencyOf(item);
    btn.innerHTML = price < item.price ? `${moneyIcon(cur)}${price} <s>${item.price}</s>` : `${moneyIcon(cur)}${price}`;
    btn.classList.add('buy');
    if (cur === 'gems') btn.classList.add('gem-buy');
    if (price < item.price) card.classList.add('on-deal');
    if ((profile?.[cur] ?? 0) < price) btn.classList.add('cant');
    btn.addEventListener('click', () => onBuy(item));
  }
  card.appendChild(btn);
  return card;
}

// A set: its pieces side by side, what's in it, and the price 10% off.
function setCard(set, { profile, freeShop, onBuySet, onView }) {
  const { full, price, missing, currency } = setPrice(set, profile);
  const card = document.createElement('div');
  card.className = 'item set-card';
  card.dataset.rarity = setRarity(set).id;
  clickable(card, t(set.name), () => onView?.(set));
  const row = document.createElement('div');
  row.className = 'set-previews';
  const theme = set.items.find((id) => ITEMS[id].type === 'board') || profile?.equipped.board || 'board-classic';
  for (const id of set.items) row.appendChild(preview(ITEMS[id], theme));
  card.appendChild(row);
  const top = document.createElement('div');
  top.className = 'set-top';
  top.innerHTML = `<div class="item-name"></div><span class="set-off">−${Math.round(SET_DISCOUNT * 100)}%</span>`;
  top.querySelector('.item-name').textContent = t(set.name);
  card.appendChild(top);
  const list = document.createElement('div');
  list.className = 'set-list';
  const KIND = { token: 'Tokens', dice: 'Dice', board: 'Board' };
  list.textContent = set.items.map((id) => t(KIND[ITEMS[id].type] || ITEMS[id].type) + (ownsItem(profile, id) ? ' ✓' : '')).join(' · ');
  card.appendChild(list);
  const btn = document.createElement('button');
  btn.className = 'btn small';
  if (!missing.length) {
    btn.textContent = `${t('Owned')} ✓`;
    btn.disabled = true;
  } else {
    btn.classList.add('buy');
    btn.innerHTML = freeShop ? `${t('Get free')} <s>${price}</s>` : `${moneyIcon(currency)}${price} <s>${full}</s>`;
    if (currency === 'gems') btn.classList.add('gem-buy');
    if (!freeShop && (profile?.[currency] ?? 0) < price) btn.classList.add('cant');
    btn.addEventListener('click', () => onBuySet(set));
  }
  card.appendChild(btn);
  return card;
}

const W = 150;
const H = 100;

// Dice, boards and Legendary tokens move (twinkles, glints, mist…), so their previews are redrawn
// while they are on screen.
const animated = []; // { canvas, draw(ctx, now) }
// Only previews you can actually see are redrawn, and at half speed (they're small). They used to
// run flat out for as long as they existed, shop open or not: after one visit to the shop every
// mini board and dice kept redrawing 60 times a second behind the game, which made games lag.
const onScreen = new WeakSet();
const watched = new WeakSet();
const watcher =
  typeof IntersectionObserver === 'function'
    ? new IntersectionObserver((entries) => {
        for (const e of entries) (e.isIntersecting ? onScreen.add(e.target) : onScreen.delete(e.target));
      })
    : null;
let lastPreview = 0;
function animate(now) {
  requestAnimationFrame(animate);
  if (!animated.length || now - lastPreview < 32) return;
  lastPreview = now;
  for (const a of animated) {
    if (!a.canvas.isConnected) continue;
    if (watcher) {
      if (!watched.has(a.canvas)) {
        watched.add(a.canvas);
        watcher.observe(a.canvas); // (it reports whether it's on screen before the next frame)
        continue;
      }
      if (!onScreen.has(a.canvas)) continue;
    } else if (a.canvas.offsetParent === null) continue;
    const ctx = a.canvas.getContext('2d');
    ctx.setTransform(a.dpr, 0, 0, a.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    a.draw(ctx, now);
  }
}
requestAnimationFrame(animate);

// Tokens are shown in the colours of your equipped board, so you see how they'll really look.
export { preview as itemPreview };
function preview(item, theme) {
  if (item.type === 'frame') {
    const d = document.createElement('div');
    d.className = 'preview frame-preview';
    d.appendChild(framedAvatar(item.id, null, 58));
    return d;
  }
  if (item.type === 'emote' && item.img) {
    const d = document.createElement('div');
    d.className = 'preview emoji';
    const img = document.createElement('img');
    img.src = item.img;
    img.alt = item.name;
    d.appendChild(img);
    return d;
  }
  if (item.type === 'emote') {
    const d = document.createElement('div');
    d.className = 'preview emoji';
    d.textContent = item.emoji;
    return d;
  }
  if (item.type === 'emote-pack') {
    const d = document.createElement('div');
    d.className = 'preview pack';
    for (const e of item.emotes.slice(0, 6)) {
      const img = document.createElement('img');
      img.src = e.img;
      img.alt = e.name;
      d.appendChild(img);
    }
    if (item.emotes.length > 6) {
      const more = document.createElement('span');
      more.textContent = `+${item.emotes.length - 6}`;
      d.appendChild(more);
    }
    return d;
  }
  const canvas = document.createElement('canvas');
  canvas.className = 'preview';
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  if (item.type === 'token') {
    const draw = (c, now) => ['red', 'green', 'yellow', 'blue'].forEach((col, i) => drawToken(c, 30 + i * 30, 68, 14, playerColor(theme, col), item.id, { sign: col, t: now }));
    draw(ctx, performance.now());
    if (rarityOf(item).id === 'legendary') animated.push({ canvas, dpr, draw }); // their effects move
  } else if (item.type === 'dice') {
    const draw = (c, now) => drawDice(c, W / 2, H / 2, 56, 5, item.id, { t: now });
    draw(ctx, performance.now());
    animated.push({ canvas, dpr, draw });
  } else if (item.type === 'taunt') {
    // looping: it pops up, holds and fades, again and again
    const draw = (c, now) => drawTauntPreview(c, item.id, W, H, now + item.id.length * 331, { name: t('Blue') });
    draw(ctx, 300);
    animated.push({ canvas, dpr, draw });
  } else if (item.type === 'board') {
    const size = H - 8;
    const off = document.createElement('canvas');
    const r = new BoardRenderer(off);
    r.setBoard(BOARDS[4], item.id);
    r.resize(size);
    const draw = (c, now) => {
      r.draw({ tokens: IN_BASE, active: [0, 1, 2, 3], skins: [], turn: null }, now);
      c.drawImage(off, (W - size) / 2, 4, size, size);
    };
    draw(ctx, performance.now());
    animated.push({ canvas, dpr, draw });
  }
  return canvas;
}
