// The shop screen: tabs plus a grid of item cards with drawn previews.
import { SHOP_ITEMS, ownsItem } from '../shared/shop.js';
import { BOARDS, COLOR_HEX } from '../shared/board.js';
import { BoardRenderer, drawToken, drawDice } from './renderer.js';

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
  for (const item of SHOP_ITEMS.filter((i) => i.type === tab)) {
    const owned = ownsItem(profile, item.id);
    const equipped = profile?.equipped[item.type] === item.id;
    const card = document.createElement('div');
    card.className = `item${equipped ? ' equipped' : ''}`;
    card.appendChild(preview(item));

    const name = document.createElement('div');
    name.className = 'item-name';
    name.textContent = item.name;
    card.appendChild(name);

    const btn = document.createElement('button');
    btn.className = 'btn small';
    if (item.type === 'emote' && owned) {
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

function preview(item) {
  if (item.type === 'emote') {
    const d = document.createElement('div');
    d.className = 'preview emoji';
    d.textContent = item.emoji;
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
    ['red', 'green', 'yellow', 'blue'].forEach((c, i) => drawToken(ctx, 30 + i * 30, 68, 14, COLOR_HEX[c], item.id));
  } else if (item.type === 'dice') {
    drawDice(ctx, W / 2, H / 2, 56, 5, item.id);
  } else if (item.type === 'board') {
    const size = H - 8;
    const off = document.createElement('canvas');
    const r = new BoardRenderer(off);
    r.setBoard(BOARDS[4], item.id);
    r.resize(size);
    r.draw({ tokens: IN_BASE, active: [0, 1, 2, 3], skins: [], turn: null }, 0);
    ctx.drawImage(off, (W - size) / 2, 4, size, size);
  }
  return canvas;
}
