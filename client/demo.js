// "Try it": a short scene on a real board, played with the item you are looking at in the shop,
// so you can see everything it does before buying it (and so new skins can be checked without
// playing a whole game). It loops: a roll, a move out of base and along the track, a capture,
// being captured in turn (the token's own way home), then winning.
import { BOARDS } from '../shared/board.js';
import { BoardRenderer } from './renderer.js';
import { playerColor, TOKEN_SIGNATURES } from './skins.js';
import { signatureHome } from './signatures.js';
import { t } from './i18n.js';
import { TAUNT_FX } from './taunts.js';
import { sfx } from './audio.js';

const easeInOut = (k) => (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
const HOP = 230; // one square
const FLY = 650; // an ordinary token flying home
const ME = 0; // you play red
const FOE = 1;
const STEPS = 5; // how far along the track the scene runs

let el = null;
let raf = 0;
let renderer = null;
let look = null;
let t0 = 0;
let fired = new Set();
let jump = null; // a part of the scene to skip to
const PARTS = [['roll', 'A roll'], ['walk', 'A move'], ['hit', 'A capture'], ['chase', 'Captured'], ['win', 'A win']];

function build() {
  el = document.createElement('div');
  el.className = 'modal-wrap demo-view hidden';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `
    <div class="modal-card demo-card">
      <button type="button" class="set-close demo-close"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
      <canvas class="demo-board"></canvas>
      <p class="demo-step"></p>
      <div class="demo-jump"></div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('pointerdown', (e) => e.target === el && closeDemo());
  el.querySelector('.demo-close').addEventListener('click', closeDemo);
  window.addEventListener('keydown', (e) => e.key === 'Escape' && el && !el.classList.contains('hidden') && (e.stopImmediatePropagation(), closeDemo()), true);
  renderer = new BoardRenderer(el.querySelector('.demo-board'));
  // Straight to one part of the scene (it carries on from there)
  for (const [at, label] of PARTS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small demo-part';
    b.dataset.at = at;
    b.dataset.label = label;
    b.addEventListener('click', () => (jump = at));
    el.querySelector('.demo-jump').appendChild(b);
  }
}

// items: { token, dice, board } (ids; anything left out is the plain Classic one)
export function openDemo(items) {
  if (!el) build();
  look = { token: items.token || 'token-classic', dice: items.dice || 'dice-classic', board: items.board || 'board-classic', taunt: items.taunt || 'taunt-none' };
  el.querySelector('.demo-close').setAttribute('aria-label', t('Close'));
  for (const b of el.querySelectorAll('.demo-part')) b.textContent = t(b.dataset.label);
  el.classList.remove('hidden');
  const size = Math.floor(Math.min(520, window.innerWidth - 48, window.innerHeight - 150));
  renderer.setBoard(BOARDS[4], look.board);
  renderer.resize(size);
  t0 = performance.now();
  fired = new Set();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
}

export function closeDemo() {
  cancelAnimationFrame(raf);
  el?.classList.add('hidden');
}

const once = (tag) => !fired.has(tag) && !!fired.add(tag);

// One hop from a to b, k 0..1
const hop = (a, b, k, high = 0.5) => ({ x: a.x + (b.x - a.x) * easeInOut(k), y: a.y + (b.y - a.y) * easeInOut(k), lift: Math.sin(Math.PI * k) * high, squash: k < 0.2 ? 0.82 + 0.9 * k : 1 });

function frame(now) {
  raf = requestAnimationFrame(frame);
  const board = BOARDS[4];
  const mine = playerColor(look.board, board.colors[ME]);
  const sig = TOKEN_SIGNATURES[look.token];
  const homeMs = sig?.ms || FLY;
  // The scene's clock: when each part starts
  const T = {};
  T.roll = 400;
  T.out = T.roll + 1300; // out of base
  T.walk = T.out + 420;
  T.hit = T.walk + STEPS * HOP; // lands on the other token: it flies home
  T.roll2 = T.hit + FLY + 500;
  T.chase = T.roll2 + 1300; // the other token comes back for you
  T.caught = T.chase + 3 * HOP + 350; // …and you go home your own way
  T.win = T.caught + homeMs + 700;
  T.end = T.win + 4800;
  if (jump) {
    t0 = now - (T[jump] - (jump === 'roll' ? 300 : 0));
    fired = new Set();
    renderer.clearTaunts();
    jump = null;
  }
  const e = (now - t0) % T.end;
  if (e < 60 && fired.size) {
    fired = new Set(); // a new loop
    renderer.clearTaunts();
  }

  // Where the other token stands: the square you will land on
  const at = (seat, p, tok = 0) => board.tokenCenter(seat, p, tok);
  const target = board.trackIndex(ME, STEPS);
  let foeP = 0;
  for (let p = 0; p < 52; p++) if (board.trackIndex(FOE, p) === target) foeP = p;

  const tokens = [[-1, -1, -1, -1], [foeP, -1, -1, -1], [-1, -1, -1, -1], [-1, -1, -1, -1]];
  const overrides = new Map();
  let dice = null;
  let step = 'A roll';
  const rollView = (start, value, seat) => {
    const d = e - start;
    if (d < 0 || d > 1250) return null;
    const color = playerColor(look.board, board.colors[seat]);
    const style = seat === ME ? look.dice : 'dice-classic';
    return d < 900 ? { mode: 'spin', t: d, value, style, color, sign: board.colors[seat], axes: [2.7, 1.6] } : { mode: 'shown', t: d - 900, value, style, color, sign: board.colors[seat] };
  };

  if (e < T.out) {
    dice = rollView(T.roll, 6, ME);
  } else if (e < T.walk) {
    step = 'Out of base';
    overrides.set('0-0', hop(at(ME, -1), at(ME, 0), (e - T.out) / 420, 1.2));
  } else if (e < T.hit) {
    step = 'A move';
    const i = Math.min(STEPS - 1, Math.floor((e - T.walk) / HOP));
    const k = ((e - T.walk) % HOP) / HOP;
    if (once(`hop${i}`)) {
      const a = at(ME, i);
      renderer.ring(a.x, a.y, mine, 0.45);
      if (sig?.legend && i > 0) renderer.burst(a.x, a.y, sig.colors, { count: 5, speed: 1.4, life: 480, size: 0.09 });
    }
    overrides.set('0-0', hop(at(ME, i), at(ME, i + 1), k));
  } else if (e < T.chase) {
    step = 'A capture';
    tokens[ME][0] = STEPS;
    const end = at(ME, STEPS);
    if (once('hit')) {
      renderer.burst(end.x, end.y, sig?.legend ? sig.colors : [mine, '#ffffff', '#ffd23f'], { count: sig?.legend ? 40 : 22, speed: sig?.legend ? 6.5 : 5, life: sig?.legend ? 900 : 700 });
      if (sig?.legend) renderer.ring(end.x, end.y, sig.colors[0], 1.6);
      const foeColor = playerColor(look.board, board.colors[FOE]);
      renderer.taunt(end.x, end.y, look.taunt, mine, { seat: FOE, color: foeColor, name: t(board.colors[FOE][0].toUpperCase() + board.colors[FOE].slice(1)) });
      if (TAUNT_FX[look.taunt]) sfx(look.taunt);
    }
    const k = Math.min(1, (e - T.hit) / FLY);
    const from = at(FOE, foeP);
    const to = at(FOE, -1);
    if (k < 1) overrides.set('1-0', { ...hop(from, to, k, 2.5), squash: 1 });
    tokens[FOE][0] = -1;
    if (e > T.roll2) {
      dice = rollView(T.roll2, 3, FOE);
      step = 'Their turn';
    }
  } else if (e < T.win) {
    step = 'Captured';
    // the other token arrives from three squares back…
    const d = e - T.chase;
    tokens[ME][0] = STEPS;
    tokens[FOE][0] = -1;
    if (d < 3 * HOP) {
      const i = Math.min(2, Math.floor(d / HOP));
      overrides.set('1-0', hop(at(FOE, foeP - 3 + i), at(FOE, foeP - 2 + i), (d % HOP) / HOP));
    } else {
      tokens[FOE][0] = foeP;
      const from = at(ME, STEPS);
      if (once('caught')) renderer.burst(from.x, from.y, [playerColor(look.board, board.colors[FOE]), '#ffffff', '#ffd23f'], { count: 22, speed: 5 });
      // …and yours goes home, in its own way if it has one
      const k = Math.min(1, (e - T.caught + 350) / homeMs);
      const to = at(ME, -1);
      tokens[ME][0] = -1;
      if (k < 1) overrides.set('0-0', sig ? signatureHome(sig, k, from, to, (tag) => once(`home-${tag}`), renderer, sfx) : { ...hop(from, to, k, 2.5), squash: 1 });
    }
  } else {
    step = 'A win';
    tokens[FOE][0] = foeP;
    if (once('win')) {
      renderer.confetti([mine, '#ffffff', '#f6cf57']);
      renderer.celebrate(ME, look.token);
      sfx('win');
      sfx('bow');
    }
  }

  const label = el.querySelector('.demo-step');
  if (label.dataset.step !== step) {
    label.dataset.step = step;
    label.textContent = t(step);
  }
  renderer.draw({ tokens, active: [0, 1, 2, 3], skins: [look.token, 'token-classic', 'token-classic', 'token-classic'], turn: ME, dice, emotes: [], overrides: overrides.size ? overrides : null }, now);
}
