import { BOARDS } from '/../shared/board.js';
import { SHOP_ITEMS } from '/../shared/shop.js';
import { BoardRenderer, drawDice } from '/renderer.js';
import { setColorBlind, playerColor } from '/skins.js';
const q = new URLSearchParams(location.search);
if (q.get('cb')) setColorBlind(true);
const t0 = Number(q.get('t') || 0);
const size = Number(q.get('size') || 600);
const only = q.get('only');
const seats = Number(q.get('seats') || 4);
const skins = (q.get('skins') || 'token-classic,token-classic,token-classic,token-classic,token-classic,token-classic').split(',');
const tokens = q.get('tok') ? JSON.parse(q.get('tok')) : [[-1, 3, 12, -1], [-1, 30, 20, -1], [5, 44, -1, -1], [-1, 18, -1, 40], [-1, -1, -1, -1], [-1, -1, -1, -1]];
const items = [];
const dice = q.get('dice');
if (dice) {
  // dice=<style>: the six faces side by side
  const names = ['red', 'green', 'blue', 'yellow', 'purple', 'orange'];
  const c = document.createElement('canvas'); c.width = 6 * 130; c.height = 140 * names.length;
  document.getElementById('root').append(c);
  const ctx = c.getContext('2d');
  const start = performance.now();
  const f = (now) => { ctx.clearRect(0, 0, c.width, c.height); names.forEach((n, row) => { for (let v = 1; v <= 6; v++) drawDice(ctx, v * 130 - 65, 70 + row * 140, 100, v, dice, { t: t0 + now - start, color: playerColor('board-constellation', n), sign: n }); }); if (now - start < 1200) requestAnimationFrame(f); else window.__done = true; };
  requestAnimationFrame(f);
} else {
  for (const it of SHOP_ITEMS.filter((i) => i.type === 'board' && (!only || only.split(',').includes(i.id)))) {
    const f = document.createElement('figure');
    const c = document.createElement('canvas');
    f.append(c, Object.assign(document.createElement('figcaption'), { textContent: it.name }));
    document.getElementById('root').append(f);
    const r = new BoardRenderer(c);
    r.setBoard(BOARDS[seats], it.id);
    r.resize(size);
    items.push(r);
  }
  const active = [...Array(seats).keys()];
  const start = performance.now();
  const frame = (now) => {
    for (const r of items) r.draw({ tokens, active, skins, turn: null }, t0 + (now - start));
    if (now - start < 1500) requestAnimationFrame(frame);
    else window.__done = true;
  };
  requestAnimationFrame(frame);
}
