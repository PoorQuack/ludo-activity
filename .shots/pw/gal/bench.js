import { BOARDS } from '/../shared/board.js';
import { SHOP_ITEMS } from '/../shared/shop.js';
import { BoardRenderer, setAnimScale } from '/renderer.js';
import { BOARD_THEMES } from '/skins.js';
const q = new URLSearchParams(location.search);
const size = Number(q.get('size') || 370);
const frames = Number(q.get('frames') || 24);
const c = document.getElementById('c');
// tokens: a few on the board, some on safe squares (shields), some paired
const tokens = [[0, 8, 20, 20], [8, 30, -1, -1], [0, 44, 12, -1], [-1, 21, 5, 40]];
const skins = Array(4).fill('token-classic');
const view = { tokens, active: [0, 1, 2, 3], skins, turn: 0, dice: { mode: 'ready', t: 500, value: null, style: 'dice-classic', color: '#e33' } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function run(id, variant) {
  view.dice = variant.includes('spin') ? { mode: 'spin', t: 300, value: 5, axes: [2.4, 1.6], style: 'dice-classic', color: '#e33' } : { mode: 'ready', t: 500, value: null, style: 'dice-classic', color: '#e33' };
  const am = /@([\d.]+)/.exec(variant); setAnimScale(am ? Number(am[1]) : 1); variant = variant.replace(/@[\d.]+/, '');
  view.busy = variant.includes('busy'); variant = variant.replace('+busy', '').replace('busy', 'spin');
  variant = variant.replace('+spin', '').replace('spin', 'full');
  const theme = BOARD_THEMES[id];
  const saved = { ...theme.art };
  if (variant === 'no-under') delete theme.art.under;
  if (variant === 'no-fx') delete theme.art.fx;
  if (variant === 'no-shield') delete theme.art.shield;
  if (variant.startsWith('sh:')) theme.art.shield = { ...theme.art.shield, ...JSON.parse(variant.slice(3)) };
  if (variant === 'bare') { delete theme.art.under; delete theme.art.fx; delete theme.art.shield; }
  const r = new BoardRenderer(c);
  r.setBoard(BOARDS[4], id);
  r.resize(size);
  r.draw(view, 0);
  await wait(400); // textures
  r.size = 0; r.draw(view, 0); r.ctx.getImageData(0, 0, 1, 1); r.draw(view, 1); r.ctx.getImageData(0, 0, 1, 1);
  const times = [];
  let t = 1000;
  for (let i = 0; i < frames; i++) {
    const a = performance.now();
    view.dice.t = 100 + i * 16.7; r.draw(view, (t += 16.7));
    r.ctx.getImageData(0, 0, 1, 1); // make the drawing actually happen before stopping the clock
    times.push(performance.now() - a);
  }
  theme.art = saved;
  times.sort((x, y) => x - y);
  return { avg: times.reduce((s, x) => s + x, 0) / times.length, p90: times[Math.floor(times.length * 0.9)] };
}
window.bench = async (variants, only) => {
  const out = {};
  for (const id of ['board-classic', 'board-ocean', 'board-classic']) await run(id, 'full'); // warm up
  for (const it of SHOP_ITEMS.filter((i) => i.type === 'board' && (!only || only.includes(i.id)))) {
    out[it.id] = {};
    for (const v of variants) out[it.id][v] = await run(it.id, v);
  }
  return out;
};
window.__ready = true;

// Frames per second through the whole pipeline (GPU included), drawing every animation frame
window.fpsRun = async (id, variant, ms = 2500) => {
  const theme = BOARD_THEMES[id];
  const saved = { ...theme.art };
  for (const k of variant.split(',').filter(Boolean)) delete theme.art[k];
  const r = new BoardRenderer(c);
  r.setBoard(BOARDS[4], id);
  r.resize(size);
  r.draw(view, performance.now());
  await wait(500);
  r.size = 0;
  const v = { ...view, busy: !!window.__busy, dice: { mode: 'spin', t: 0, value: 5, axes: [2.4, 1.6], style: 'dice-classic', color: '#e33' } };
  let n = 0;
  const t0 = performance.now();
  await new Promise((done) => {
    const f = (now) => {
      if (now - t0 > ms) return done();
      v.dice.t = (now - t0) % 900;
      r.draw(v, now);
      n++;
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  theme.art = saved;
  return Math.round((n * 1000) / ms);
};
