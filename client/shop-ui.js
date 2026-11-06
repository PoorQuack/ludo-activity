// The shop screen: tabs plus a grid of item cards with drawn previews.
import { SHOP_ITEMS, ownsItem } from '../shared/shop.js';
import { BOARDS } from '../shared/board.js';
import { BoardRenderer, drawToken, drawDice } from './renderer.js';
import { playerColor } from './skins.js';

const IN_BASE = [0, 1, 2, 3].map(() => [-1, -1, -1, -1]);

export const SHOP_TABS = [
  { type: 'token', label: 'Tokens' },
  { type: 'dice', label: 'Dice' },
  { type: 'board', label: 'Boards' },
  { type: 'emote', label: 'Emotes' },
];

export function renderShop({ tabs, grid }, { tab, profile, freeShop = false, onTab, onBuy, onEquip }) {
  tabs.innerHTML = '';
  for (const t of SHOP_TABS) {
    const b = document.createElement('button');
    b.className = `tab${t.type === tab ? ' active' : ''}`;
    b.textContent = t.label;
    b.addEventListener('click', () => onTab(t.type));
    tabs.appendChild(b);
  }

  grid.innerHTML = '';
  animated.length = 0;
  for (const item of SHOP_ITEMS.filter((i) => i.type === tab || (tab === 'emote' && i.type === 'emote-pack'))) {
    const owned = ownsItem(profile, item.id);
    const equipped = profile?.equipped[item.type] === item.id;
    const card = document.createElement('div');
    card.className = `item${equipped ? ' equipped' : ''}`;
    card.appendChild(preview(item, profile?.equipped.board || 'board-classic'));

    const name = document.createElement('div');
    name.className = 'item-name';
    name.textContent = item.name;
    card.appendChild(name);

    const btn = document.createElement('button');
    btn.className = 'btn small';
    if ((item.type === 'emote' || item.type === 'emote-pack') && owned) {
      btn.textContent = 'Owned';
      btn.disabled = true;
    } else if (equipped) {
      btn.textContent = 'Equipped ✓';
      btn.disabled = true;
    } else if (owned) {
      btn.textContent = 'Equip';
      btn.addEventListener('click', () => onEquip(item));
    } else if (freeShop) {
      btn.innerHTML = `Get free <s>${item.price}</s>`;
      btn.classList.add('buy');
      btn.addEventListener('click', () => onBuy(item));
    } else {
      btn.innerHTML = `<span class="coin"></span>${item.price}`;
      btn.classList.add('buy');
      if ((profile?.coins ?? 0) < item.price) btn.classList.add('cant');
      btn.addEventListener('click', () => onBuy(item));
    }
    card.appendChild(btn);
    grid.appendChild(card);
  }
}

const W = 150;
const H = 100;

// Dice and boards move (twinkles, glints, embers…), so their previews are redrawn every frame
// while the shop is on screen.
const animated = []; // { canvas, draw(ctx, now) }
function animate(now) {
  requestAnimationFrame(animate);
  for (const a of animated) {
    if (!a.canvas.isConnected) continue;
    const ctx = a.canvas.getContext('2d');
    ctx.setTransform(a.dpr, 0, 0, a.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    a.draw(ctx, now);
  }
}
requestAnimationFrame(animate);

// Tokens are shown in the colours of your equipped board, so you see how they'll really look.
function preview(item, theme) {
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
    ['red', 'green', 'yellow', 'blue'].forEach((c, i) => drawToken(ctx, 30 + i * 30, 68, 14, playerColor(theme, c), item.id, { sign: c }));
  } else if (item.type === 'dice') {
    const draw = (c, now) => drawDice(c, W / 2, H / 2, 56, 5, item.id, { t: now });
    draw(ctx, performance.now());
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
