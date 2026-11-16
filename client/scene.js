// Scene lighting: a board lit like a place. Golden-hour sun from the top-left, cherry trees
// over the corners casting dappled shade, light shafts, a soft bloom, a vignette, and petals
// that drift down with their own little shadows. (Used by the Sakura board: `art.scene`.)
//
// Almost all of it is painted ONCE, onto a copy of the finished board (litBoard). What moves
// is cheap: the shade (one image, swaying a couple of pixels), the shafts (one image whose
// strength breathes) and the petals. No ctx.filter anywhere (iPhones ignore it): soft shadows
// and bloom are made by drawing small and scaling back up.
//
// Everything is in board units (one square = 1) from the board's middle, like the rest of the
// board drawing; `k` is device pixels per unit and `mid` the middle in device pixels.
import { TAU } from './draw-util.js';

// Players can turn scene lighting off (Settings). Renderers watch `version` to repaint.
export const sceneSwitch = { on: true, version: 0 };
export function setSceneLighting(on) {
  if (sceneSwitch.on === !!on) return;
  sceneSwitch.on = !!on;
  sceneSwitch.version++;
}

// How far and which way shadows fall (board units): low sun, so long ones
export const SUN = { dx: 0.85, dy: 1.05 };

const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f))));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
};

function petal(g, len) {
  g.beginPath();
  g.moveTo(0, 0);
  g.bezierCurveTo(-len * 0.55, -len * 0.25, -len * 0.55, -len * 0.85, -len * 0.16, -len);
  g.lineTo(0, -len * 0.84);
  g.lineTo(len * 0.16, -len);
  g.bezierCurveTo(len * 0.55, -len * 0.85, len * 0.55, -len * 0.25, 0, 0);
  g.fill();
}
function blossom(g, x, y, r, fill, heart) {
  g.save();
  g.translate(x, y);
  g.fillStyle = fill;
  for (let i = 0; i < 5; i++) {
    g.rotate(TAU / 5);
    petal(g, r);
  }
  g.fillStyle = heart;
  g.beginPath();
  g.arc(0, 0, r * 0.22, 0, TAU);
  g.fill();
  g.restore();
}

// The clumps of blossom that make up one tree's canopy: [x, y, radius], front ones last
function canopy(seed) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < 40; i++) {
    const a = r() * TAU;
    const d = Math.sqrt(r()) * 1.3;
    out.push([Math.cos(a) * d, Math.sin(a) * d, 0.3 + r() * 0.3]);
  }
  return out.sort((p, q) => q[0] + q[1] - p[0] - p[1]);
}

// A soft copy of a canvas: down to 1/f of its size and back up
function soften(src, f) {
  const w = Math.max(2, Math.round(src.width / f));
  const small = document.createElement('canvas');
  small.width = small.height = w;
  const sg = small.getContext('2d');
  sg.imageSmoothingQuality = 'high';
  sg.drawImage(src, 0, 0, w, w);
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const og = out.getContext('2d');
  og.imageSmoothingQuality = 'high';
  og.drawImage(small, 0, 0, out.width, out.height);
  return out;
}

/**
 * The finished board (`board`: a canvas), lit. Returns { canvas, shade, rays }: the lit board,
 * and the two images the moving effect lays over it.
 * `half`: half the board's width in units.
 */
export function litBoard(board, k, mid, half) {
  const W = board.width;
  const make = () => {
    const c = document.createElement('canvas');
    c.width = c.height = W;
    return c;
  };
  const canvas = make();
  let g = canvas.getContext('2d');
  g.drawImage(board, 0, 0);
  const units = () => g.setTransform(k, 0, 0, k, mid, mid);
  const pixels = () => g.setTransform(1, 0, 0, 1, 0, 0);
  const at = half - 0.95; // the trees stand just inside the four corners
  const trees = [[-at, -at, 11], [at, -at, 23], [at, at, 37], [-at, at, 53]];

  // petals that have already fallen, thicker under the trees
  units();
  const rnd = rng(7);
  for (let i = 0; i < 150; i++) {
    const tr = trees[i % 4];
    const near = i < 90;
    const x = near ? tr[0] + (rnd() - 0.4) * 5 * -Math.sign(tr[0]) : (rnd() * 2 - 1) * half;
    const y = near ? tr[1] + (rnd() - 0.4) * 5 * -Math.sign(tr[1]) : (rnd() * 2 - 1) * half;
    g.save();
    g.translate(x, y);
    g.rotate(rnd() * TAU);
    g.scale(1, 0.6 + rnd() * 0.4);
    g.fillStyle = ['rgba(255,190,212,0.9)', 'rgba(255,225,235,0.9)', 'rgba(250,150,185,0.85)'][i % 3];
    petal(g, 0.07 + rnd() * 0.07);
    g.restore();
  }

  // the shade the trees cast, on its own canvas (it sways): each canopy, moved along the sun,
  // with gaps in the leaves for dapples of light
  const shadeC = make();
  const sg = shadeC.getContext('2d');
  sg.setTransform(k, 0, 0, k, mid, mid);
  sg.fillStyle = '#000';
  for (const [tx, ty, seed] of trees) {
    for (const [bx, by, br] of canopy(seed)) {
      sg.beginPath();
      sg.arc(tx + bx + SUN.dx, ty + by + SUN.dy, br, 0, TAU);
      sg.fill();
    }
  }
  sg.globalCompositeOperation = 'destination-out';
  for (const [tx, ty, seed] of trees) {
    const r2 = rng(seed + 1);
    for (let i = 0; i < 26; i++) {
      const a = r2() * TAU;
      const d = Math.sqrt(r2()) * 1.25;
      sg.beginPath();
      sg.arc(tx + Math.cos(a) * d + SUN.dx, ty + Math.sin(a) * d + SUN.dy, 0.07 + r2() * 0.11, 0, TAU);
      sg.fill();
    }
    // (and none of it on the tree itself)
    for (const [bx, by, br] of canopy(seed)) {
      sg.beginPath();
      sg.arc(tx + bx, ty + by, br, 0, TAU);
      sg.fill();
    }
  }
  sg.globalCompositeOperation = 'source-in';
  sg.setTransform(1, 0, 0, 1, 0, 0);
  sg.fillStyle = '#4a2358';
  sg.fillRect(0, 0, W, W);

  // the trees: two boughs reaching in, a dark under-layer, the canopy lit from the top-left,
  // sunlit tufts, then single blossoms. On their own canvas: they stand partly outside the
  // board's shape (in the empty corners of the six-player board), and are lit separately.
  const treeC = make();
  const boardG = g;
  g = treeC.getContext('2d');
  g.setTransform(k, 0, 0, k, mid, mid);
  for (const [tx, ty, seed] of trees) {
    const bl = canopy(seed);
    const r2 = rng(seed + 2);
    const dx = -Math.sign(tx);
    const dy = -Math.sign(ty);
    g.strokeStyle = '#4e2c20';
    g.lineCap = 'round';
    g.lineWidth = 0.15;
    g.beginPath();
    g.moveTo(tx - dx * 0.4, ty - dy * 0.4);
    g.quadraticCurveTo(tx + dx * 0.5, ty + dy * 0.05, tx + dx * 1.5, ty + dy * 0.2);
    g.stroke();
    g.lineWidth = 0.09;
    g.beginPath();
    g.moveTo(tx, ty);
    g.quadraticCurveTo(tx + dx * 0.05, ty + dy * 0.8, tx + dx * 0.2, ty + dy * 1.5);
    g.stroke();
    blossom(g, tx + dx * 1.5, ty + dy * 0.2, 0.2, '#ffc4d8', '#d63a72');
    blossom(g, tx + dx * 0.2, ty + dy * 1.5, 0.2, '#ffc4d8', '#d63a72');
    g.fillStyle = '#a13c6c';
    for (const [bx, by, br] of bl) {
      g.beginPath();
      g.arc(tx + bx + 0.1, ty + by + 0.14, br, 0, TAU);
      g.fill();
    }
    for (const [bx, by, br] of bl) {
      const light = Math.max(0, Math.min(1, 0.5 - (bx + by) * 0.3));
      g.fillStyle = shade('#f2749f', light * 0.62 - 0.12);
      g.beginPath();
      g.arc(tx + bx, ty + by, br, 0, TAU);
      g.fill();
    }
    for (const [bx, by, br] of bl) {
      const light = Math.max(0, 0.5 - (bx + by) * 0.3);
      g.fillStyle = `rgba(255,226,236,${0.15 + light * 0.4})`;
      g.beginPath();
      g.arc(tx + bx - 0.1, ty + by - 0.12, br * 0.5, 0, TAU);
      g.fill();
    }
    for (let i = 0; i < 22; i++) {
      const a = r2() * TAU;
      const d = Math.sqrt(r2()) * 1.3;
      blossom(g, tx + Math.cos(a) * d, ty + Math.sin(a) * d, 0.12, '#ffe9f0', '#d63a72');
    }
  }

  // ---- the light ----
  // warm sun from the top-left, cool violet in the far corner, the whole thing a little amber;
  // then cut back to the picture's own shape (the passes also paint where it was empty)
  const light = (c) => {
    const shape = make();
    shape.getContext('2d').drawImage(c, 0, 0);
    const cg = c.getContext('2d');
    cg.setTransform(1, 0, 0, 1, 0, 0);
    const pass = (op, fill) => {
      cg.globalCompositeOperation = op;
      cg.fillStyle = fill;
      cg.fillRect(0, 0, W, W);
    };
    let lg = cg.createRadialGradient(0, 0, 0, 0, 0, W * 1.25);
    lg.addColorStop(0, 'rgba(255,170,90,0.75)');
    lg.addColorStop(1, 'rgba(255,225,170,0)');
    pass('soft-light', lg);
    lg = cg.createRadialGradient(W, W, 0, W, W, W * 1.1);
    lg.addColorStop(0, 'rgba(120,60,130,0.42)');
    lg.addColorStop(1, 'rgba(110,90,170,0)');
    pass('multiply', lg);
    pass('soft-light', 'rgba(255,140,80,0.35)');
    cg.globalCompositeOperation = 'destination-in';
    cg.drawImage(shape, 0, 0);
    cg.globalCompositeOperation = 'source-over';
  };
  light(canvas);
  light(treeC);
  g = boardG;
  pixels();
  g.drawImage(treeC, 0, 0);
  const pass = (op, fill) => {
    g.globalCompositeOperation = op;
    g.fillStyle = fill;
    g.fillRect(0, 0, W, W);
    g.globalCompositeOperation = 'source-over';
  };
  let gr;
  // bloom: the bright parts, softened, laid back over the picture
  const small = document.createElement('canvas');
  small.width = small.height = 96;
  const s2 = small.getContext('2d');
  s2.drawImage(canvas, 0, 0, 96, 96);
  s2.globalCompositeOperation = 'multiply';
  s2.drawImage(small, 0, 0);
  s2.drawImage(small, 0, 0);
  g.globalCompositeOperation = 'screen';
  g.globalAlpha = 0.3;
  g.imageSmoothingQuality = 'high';
  g.drawImage(small, 0, 0, W, W);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  // vignette (only where the board is: its rounded corners stay clear)
  gr = g.createRadialGradient(W / 2, W / 2, W * 0.42, W / 2, W / 2, W * 0.78);
  gr.addColorStop(0, 'rgba(40,10,50,0)');
  gr.addColorStop(1, 'rgba(60,20,70,0.3)');
  pass('source-atop', gr);

  // light shafts slanting down from the top-left, fading as they cross the board
  const rays = make();
  const rg = rays.getContext('2d');
  const r3 = rng(99);
  rg.translate(W / 2, W / 2);
  rg.rotate(0.62);
  rg.translate(-W * 0.9, -W * 0.9);
  for (let i = 0; i < 9; i++) {
    const x = W * 0.25 + r3() * W * 1.3;
    const w = W * (0.03 + r3() * 0.08);
    const lg = rg.createLinearGradient(x, 0, x + w, 0);
    lg.addColorStop(0, 'rgba(255,206,140,0)');
    lg.addColorStop(0.5, `rgba(255,206,140,${0.16 + r3() * 0.16})`);
    lg.addColorStop(1, 'rgba(255,206,140,0)');
    rg.fillStyle = lg;
    rg.fillRect(x, 0, w, W * 1.9);
  }
  rg.setTransform(1, 0, 0, 1, 0, 0);
  rg.globalCompositeOperation = 'destination-in';
  const fade = rg.createLinearGradient(0, 0, W, W);
  fade.addColorStop(0, 'rgba(0,0,0,1)');
  fade.addColorStop(0.75, 'rgba(0,0,0,0.15)');
  fade.addColorStop(1, 'rgba(0,0,0,0)');
  rg.fillStyle = fade;
  rg.fillRect(0, 0, W, W);
  // (keep both inside the board's own shape)
  for (const c of [shadeC, rays]) {
    const cg = c.getContext('2d');
    cg.setTransform(1, 0, 0, 1, 0, 0);
    cg.globalCompositeOperation = 'destination-in';
    cg.drawImage(board, 0, 0);
  }
  return { canvas, shade: soften(shadeC, 5), rays };
}

// The falling petals: the same ones for every board (positions in 0..1 of the board's width)
const pr = rng(5);
const PETALS = Array.from({ length: 40 }, () => ({ x: pr(), y: pr(), s: 0.09 + pr() * 0.1, v: 0.28 + pr() * 0.38, ph: pr() * TAU, sp: 0.8 + pr() * 1.6, h: 0.4 + pr() * 0.9 }));

/**
 * What moves, drawn over the lit board (and under the pieces): the swaying shade, the petals
 * with their shadows, the breathing light shafts. `w`: the width in device pixels of the
 * canvas being drawn on (the effect layer can be smaller than the board).
 */
export function drawSceneFx(ctx, lit, k, mid, half, now, w) {
  const t = now / 1000;
  const span = half * 2;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 0.55;
  ctx.drawImage(lit.shade, Math.sin(t * 0.7) * 0.04 * k, Math.cos(t * 0.5) * 0.035 * k, w, w);
  ctx.globalAlpha = 1;
  ctx.setTransform(k, 0, 0, k, mid, mid);
  for (const p of PETALS) {
    // down and to the right, on the breeze, wrapping round
    const fall = t * p.v * 0.06;
    const x = (((p.x + fall * 0.75 + Math.sin(t * p.sp + p.ph) * 0.012) % 1.1) - 0.05) * span - half;
    const y = (((p.y + fall) % 1.1) - 0.05) * span - half;
    const flip = Math.sin(t * p.sp * 1.7 + p.ph);
    ctx.fillStyle = 'rgba(60,25,75,0.16)';
    ctx.beginPath();
    ctx.ellipse(x + 0.16 * p.h, y + 0.2 * p.h, p.s * 0.5, p.s * 0.28, 0.6, 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * p.sp + p.ph);
    ctx.scale(1, 0.35 + 0.65 * Math.abs(flip));
    ctx.fillStyle = flip > 0 ? '#ffd3e1' : '#ff9fc0';
    petal(ctx, p.s);
    ctx.restore();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 0.52 + 0.18 * Math.sin(t * 0.6);
  ctx.drawImage(lit.rays, 0, 0, w, w);
  ctx.restore();
}

// A piece's long shadow across the board, the same way as everything else's. (x, y): its foot,
// in the pixels the pieces are drawn in; r: its radius.
export function pieceShadow(ctx, x, y, r) {
  ctx.save();
  ctx.translate(x, y + r * 0.1);
  ctx.rotate(Math.atan2(SUN.dy, SUN.dx));
  ctx.fillStyle = 'rgba(60,25,75,0.3)';
  ctx.beginPath();
  ctx.ellipse(r * 1.45, 0, r * 1.85, r * 0.42, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}
